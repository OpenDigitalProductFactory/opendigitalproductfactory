---
name: find-knowledge
description: "Search the knowledge base for articles relevant to a product or portfolio"
category: portfolio
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "conversation"
triggerPattern: "knowledge|article|documentation"
userInvocable: true
agentInvocable: true
allowedTools: [search_knowledge, search_knowledge_base]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Find Knowledge Articles

Search the knowledge base for articles relevant to this product or portfolio. Show me what's available.

## Steps

1. Ask the user what topic or product they want knowledge about.
2. Use `search_knowledge` or `search_knowledge_base` to find relevant articles.
3. Present results with title, summary, and relevance to the query.
4. If no results, suggest broadening the search or note that the knowledge base may need content.

## Guidelines

- Try both `search_knowledge` and `search_knowledge_base` if the first returns no results.
- Present articles in order of relevance, not alphabetically.
- Include a brief excerpt or summary for each article so the user can decide which to read.
- If the knowledge base is empty, suggest creating a backlog item to populate it.
