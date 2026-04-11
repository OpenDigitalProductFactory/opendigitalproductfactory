---
name: health-summary
description: "Analyse portfolio health metrics — strengths, risks, and recommended actions"
category: portfolio
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "health|risk|portfolio analysis"
userInvocable: true
agentInvocable: true
allowedTools: [search_portfolio_context]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Portfolio Health Summary

Analyse the health metrics for this portfolio — what's strong, what's at risk?

## Steps

1. Use `search_portfolio_context` to retrieve the current portfolio data visible on the page.
2. Identify products grouped by lifecycle stage and status.
3. Flag any products that are stalled (no activity for > 30 days), blocked, or missing key metadata.
4. Summarise strengths: products advancing on schedule, high completion rates, well-staffed teams.
5. Summarise risks: products with no owner, products stuck in early stages, dependency bottlenecks.
6. Present a concise health scorecard with clear categories (Green / Amber / Red).

## Guidelines

- Keep the summary under 500 words unless the user asks for detail.
- Always cite specific product names when flagging risks.
- If the portfolio is empty or has fewer than 3 products, note that the sample size limits meaningful analysis.
- End with 2-3 actionable recommendations the user can act on immediately.
- Do not fabricate metrics — only report what the data supports.
