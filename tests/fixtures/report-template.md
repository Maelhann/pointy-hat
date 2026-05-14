# Quarterly Financial Report

## Executive Summary

<!-- @begin:executive-summary -->
prompt: |
  Write a 2-3 paragraph executive summary covering key financial highlights,
  revenue growth, and major changes from the previous quarter.
quality_check:
  criteria: "Summary mentions revenue, profit margins, and quarter-over-quarter comparison"
  min_score: 0.8
  retry_on_failure: true
  max_retries: 2
<!-- @end:executive-summary -->

## Revenue Analysis

<!-- @begin:revenue-analysis -->
prompt: |
  Analyze revenue data broken down by product line and geographic region.
  Include tables where appropriate.
quality_check:
  criteria: "Analysis includes specific numbers, percentage changes, and identifies top-performing segments"
  min_score: 0.7
<!-- @end:revenue-analysis -->

## Expense Breakdown

<!-- @begin:expense-breakdown -->
prompt: |
  Break down operating expenses by category.
  Highlight any unusual or one-time expenses.
<!-- @end:expense-breakdown -->

## Conclusions and Recommendations

<!-- @begin:conclusions -->
prompt: |
  Summarize key findings and provide at least 3 actionable
  recommendations for the next quarter.
quality_check:
  criteria: "Includes at least 3 specific, actionable recommendations grounded in the data"
  min_score: 0.75
  retry_on_failure: true
  max_retries: 1
<!-- @end:conclusions -->
