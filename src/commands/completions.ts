import type { Command } from "commander";

const BASH_COMPLETION = `
_pointyhat_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="init config provider auth spell spellbook doctor search info install uninstall update list quality publish version completions"

  case "\${prev}" in
    pointyhat|ph)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
    config)
      COMPREPLY=( $(compgen -W "set get list delete reset" -- "\${cur}") )
      return 0
      ;;
    provider)
      COMPREPLY=( $(compgen -W "setup list set use test" -- "\${cur}") )
      return 0
      ;;
    auth)
      COMPREPLY=( $(compgen -W "login logout status token" -- "\${cur}") )
      return 0
      ;;
    spell)
      COMPREPLY=( $(compgen -W "create validate cast list search info export" -- "\${cur}") )
      return 0
      ;;
    spellbook)
      COMPREPLY=( $(compgen -W "add remove list sync" -- "\${cur}") )
      return 0
      ;;
    quality)
      COMPREPLY=( $(compgen -W "test scan rate verify" -- "\${cur}") )
      return 0
      ;;
  esac
}
complete -F _pointyhat_completions pointyhat
complete -F _pointyhat_completions ph
`;

const ZSH_COMPLETION = `
#compdef pointyhat ph

_pointyhat() {
  local -a commands
  commands=(
    'init:Initialize Pointy Hat'
    'config:Manage configuration'
    'provider:Manage LLM providers'
    'auth:Manage authentication'
    'spell:Manage and cast spells'
    'spellbook:Manage spellbook'
    'doctor:Diagnose environment'
    'search:Search registry'
    'info:Package info'
    'install:Install MCP servers'
    'uninstall:Uninstall MCP servers'
    'update:Update packages'
    'list:List installed packages'
    'quality:Quality tools'
    'publish:Publish packages'
    'completions:Shell completions'
  )

  _arguments '1: :->command' '*:: :->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
  esac
}

compdef _pointyhat pointyhat
compdef _pointyhat ph
`;

const FISH_COMPLETION = `
complete -c pointyhat -n '__fish_use_subcommand' -a init -d 'Initialize Pointy Hat'
complete -c pointyhat -n '__fish_use_subcommand' -a config -d 'Manage configuration'
complete -c pointyhat -n '__fish_use_subcommand' -a provider -d 'Manage LLM providers'
complete -c pointyhat -n '__fish_use_subcommand' -a auth -d 'Manage authentication'
complete -c pointyhat -n '__fish_use_subcommand' -a spell -d 'Manage and cast spells'
complete -c pointyhat -n '__fish_use_subcommand' -a doctor -d 'Diagnose environment'
complete -c pointyhat -n '__fish_use_subcommand' -a search -d 'Search registry'
complete -c pointyhat -n '__fish_use_subcommand' -a install -d 'Install MCP servers'
complete -c pointyhat -n '__fish_use_subcommand' -a list -d 'List installed packages'
complete -c pointyhat -n '__fish_use_subcommand' -a completions -d 'Shell completions'
complete -c ph -w pointyhat
`;

const POWERSHELL_COMPLETION = `
Register-ArgumentCompleter -CommandName pointyhat,ph -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @('init','config','provider','auth','spell','spellbook','doctor','search','info','install','uninstall','update','list','quality','publish','completions')
  $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;

export function registerCompletionsCommand(program: Command): void {
  program
    .command("completions <shell>")
    .description("Output shell completion script")
    .action((shell: string) => {
      switch (shell) {
        case "bash":
          console.log(BASH_COMPLETION.trim());
          break;
        case "zsh":
          console.log(ZSH_COMPLETION.trim());
          break;
        case "fish":
          console.log(FISH_COMPLETION.trim());
          break;
        case "powershell":
          console.log(POWERSHELL_COMPLETION.trim());
          break;
        default:
          console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish, powershell`);
          process.exit(1);
      }
    });
}
