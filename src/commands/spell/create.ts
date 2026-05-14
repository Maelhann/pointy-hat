import { join } from "node:path";
import type { Command } from "commander";
import { handleError } from "../../core/error-handler.js";
import { fileExists } from "../../utils/fs.js";
import { writeYamlFile } from "../../utils/yaml.js";
import { formatSuccess, formatWarning } from "../../ui/format.js";
import { input, select } from "../../ui/prompt.js";
import chalk from "chalk";

const TEMPLATES: Record<string, object> = {
  blank: {
    spell: {
      name: "{{name}}",
      version: "0.1.0",
      description: "A new Pointy Hat spell",
      author: "you",
      tags: [],
      inputs: { required: [], optional: [] },
      requires: { tools: [], resources: [] },
      steps: [
        {
          id: "main",
          instruction: "Describe what this step should do.",
        },
      ],
      outputs: [],
      metadata: {},
    },
  },
  "code-review": {
    spell: {
      name: "{{name}}",
      version: "0.1.0",
      description: "Automated code review with quality gates",
      author: "you",
      tags: ["code", "review", "quality"],
      inputs: {
        required: [
          { id: "source-code", description: "Source code files to review", formats: ["py", "ts", "js", "go", "rs"] },
        ],
        optional: [
          { id: "style-guide", description: "Coding style guide or conventions", formats: ["md", "txt"] },
        ],
      },
      requires: {
        tools: [
          { uri: "mcp://filesystem/read_file", reason: "Read source files" },
        ],
      },
      steps: [
        {
          id: "analyze-code",
          instruction: "Read and analyze the provided source code. Identify potential bugs, security issues, performance problems, and style violations.",
          inputs_needed: ["source-code"],
        },
        {
          id: "generate-review",
          instruction: "Write a detailed code review report with specific line references, severity ratings, and suggested fixes.",
          depends_on: ["analyze-code"],
          quality_check: {
            criteria: "Review must include specific code references, severity ratings (critical/major/minor), and actionable suggestions for each finding.",
            min_score: 0.7,
            retry_on_failure: true,
            max_retries: 2,
          },
        },
      ],
      outputs: [
        { id: "review-report", type: "document", format: ["md"] },
      ],
      metadata: { category: "development", estimated_duration: "2-5 minutes" },
    },
  },
  "data-analysis": {
    spell: {
      name: "{{name}}",
      version: "0.1.0",
      description: "Data analysis and insights generation",
      author: "you",
      tags: ["data", "analysis", "insights"],
      inputs: {
        required: [
          { id: "dataset", description: "Data to analyze", formats: ["csv", "json", "xlsx"] },
        ],
        optional: [
          { id: "analysis-brief", description: "What to focus the analysis on", formats: ["txt", "md"] },
        ],
      },
      requires: { tools: [], resources: [] },
      steps: [
        {
          id: "explore-data",
          instruction: "Examine the dataset structure, identify columns, data types, and basic statistics. Look for patterns, outliers, and data quality issues.",
          inputs_needed: ["dataset"],
        },
        {
          id: "analyze",
          instruction: "Perform deeper analysis based on the data exploration. Identify key trends, correlations, and actionable insights.",
          depends_on: ["explore-data"],
        },
        {
          id: "generate-report",
          instruction: "Create a comprehensive analysis report with visualizations descriptions, key findings, and recommendations.",
          depends_on: ["analyze"],
          quality_check: {
            criteria: "Report must include specific numbers from the data, at least 3 key findings, and actionable recommendations.",
            min_score: 0.75,
            retry_on_failure: true,
            max_retries: 2,
          },
        },
      ],
      outputs: [
        { id: "analysis-report", type: "document", format: ["md"] },
        { id: "metrics", type: "data", format: ["json"] },
      ],
      metadata: { category: "data", estimated_duration: "3-8 minutes" },
    },
  },
  "report-generation": {
    spell: {
      name: "{{name}}",
      version: "0.1.0",
      description: "Professional report generation from raw data",
      author: "you",
      tags: ["reports", "documents", "professional"],
      inputs: {
        required: [
          { id: "source-data", description: "Raw data or notes for the report", formats: ["csv", "json", "txt", "md"] },
          { id: "report-type", description: "Type of report (e.g., quarterly, status, technical)", formats: ["text"] },
        ],
        optional: [],
      },
      catalysts: [
        {
          id: "report-template",
          description: "Professional report formatting and section layout guidelines",
          uri: "catalyst://{{name}}/report-template.md",
          type: "template",
        },
        {
          id: "style-guide",
          description: "Writing style and tone guidelines for professional reports",
          uri: "catalyst://{{name}}/style-guide.md",
          type: "reference",
        },
      ],
      requires: { tools: [], resources: [] },
      steps: [
        {
          id: "extract-data",
          instruction: "Parse and extract key information from the provided source data.",
          inputs_needed: ["source-data"],
        },
        {
          id: "draft-report",
          instruction: "Write a professional report draft based on the extracted data. Follow the report template catalyst for structure and the style guide for tone.",
          depends_on: ["extract-data"],
          inputs_needed: ["report-type"],
          catalysts_needed: ["report-template", "style-guide"],
        },
        {
          id: "polish-report",
          instruction: "Review and polish the draft. Ensure professional tone, correct formatting, and that all data points are accurately cited.",
          depends_on: ["draft-report"],
          quality_check: {
            criteria: "Report must be professionally formatted, include an executive summary, use specific data points (no placeholders), and have actionable recommendations.",
            min_score: 0.8,
            retry_on_failure: true,
            max_retries: 2,
          },
        },
      ],
      outputs: [
        { id: "report", type: "document", format: ["md", "pdf"] },
      ],
      metadata: { category: "business", estimated_duration: "5-10 minutes" },
    },
  },
};

export function registerSpellCreateCommand(spellCmd: Command): void {
  spellCmd
    .command("create [name]")
    .description("Create a new spell")
    .option(
      "-t, --template <template>",
      "Template: blank, code-review, data-analysis, report-generation",
      "blank",
    )
    .option("-i, --interactive", "Interactive mode with prompts")
    .action(async (name: string | undefined, opts: { template: string; interactive?: boolean }) => {
      try {
        // Get spell name
        let spellName = name;
        if (!spellName) {
          spellName = await input("Spell name (lowercase-kebab-case):");
        }
        if (!spellName) {
          console.log("Cancelled.");
          return;
        }

        // Validate name format
        if (!/^[a-z][a-z0-9-]*$/.test(spellName)) {
          console.log(
            formatWarning("Spell name must be lowercase-kebab-case (e.g., my-spell)."),
          );
          return;
        }

        // Get template
        let templateName = opts.template;
        if (opts.interactive) {
          templateName = await select("Choose a template:", [
            { name: "Blank", value: "blank", description: "Empty spell with one step" },
            { name: "Code Review", value: "code-review", description: "Code review with quality gates" },
            { name: "Data Analysis", value: "data-analysis", description: "Data analysis and insights" },
            { name: "Report Generation", value: "report-generation", description: "Professional report generation" },
          ]);
        }

        const template = TEMPLATES[templateName];
        if (!template) {
          console.log(formatWarning(`Unknown template "${templateName}". Valid: ${Object.keys(TEMPLATES).join(", ")}`));
          return;
        }

        // Apply spell name to template
        const spellData = JSON.parse(
          JSON.stringify(template).replace(/\{\{name\}\}/g, spellName),
        );

        // Write file
        const fileName = `${spellName}.spell.yaml`;
        const filePath = join(process.cwd(), fileName);

        if (await fileExists(filePath)) {
          console.log(formatWarning(`${fileName} already exists.`));
          return;
        }

        await writeYamlFile(filePath, spellData);

        console.log(formatSuccess(`Created ${chalk.bold(fileName)}`));
        console.log(chalk.dim(`\nNext steps:`));
        console.log(chalk.dim(`  pointyhat spell validate ${fileName}`));
        console.log(chalk.dim(`  pointyhat spell cast ${fileName} --dry-run`));
        console.log();
      } catch (err) {
        handleError(err);
      }
    });
}
