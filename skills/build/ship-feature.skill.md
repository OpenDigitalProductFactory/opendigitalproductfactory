---
name: ship-feature
description: "Ship a completed feature through the release pipeline"
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "conversation"
triggerPattern: "ship|deploy|release|launch"
userInvocable: true
agentInvocable: true
allowedTools: [deploy_feature, create_release_bundle]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Ship a Feature

I'm ready to ship this feature.

## Steps

1. Confirm which feature the user wants to ship. Check PAGE DATA for context.
2. Review the feature's readiness: is the build complete, are tests passing?
3. If ready, use `create_release_bundle` to package the feature.
4. Use `deploy_feature` to initiate deployment.
5. Confirm the deployment status and provide any post-deploy steps.

## Guidelines

- Never deploy without the user's explicit confirmation.
- Check for any blocking issues before initiating deployment.
- If the feature is not ready, explain what needs to happen first.
- After deployment, summarise what was shipped and any monitoring to watch.
- If deployment fails, provide clear error information and recovery steps.
