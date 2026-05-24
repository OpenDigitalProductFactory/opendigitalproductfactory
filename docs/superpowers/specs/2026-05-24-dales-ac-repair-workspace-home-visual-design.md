# Dale's AC Repair Workspace Home Visual Design

| Field | Value |
| ----- | ----- |
| Status | Draft visual direction |
| Date | 2026-05-24 |
| Backlog item | `BI-5656E9C3` |
| Follow-on implementation | `BI-CE6AF925` |
| Primitive library | `BI-5B8FE5C1` |
| Mockup | [`docs/superpowers/mockups/2026-05-24-dales-ac-repair-workspace-home.html`](../mockups/2026-05-24-dales-ac-repair-workspace-home.html) |

## Purpose

Dale's AC Repair should not land on a generic platform dashboard. The first screen should look like the working board of a four-truck HVAC shop: what needs dispatch, where the techs are, which customers need updates, what parts are missing, and which coworker suggestions are ready for Dale to approve.

This mockup is a browser-rendered approximation, not implementation code. It is meant to validate the visual paradigm before `BI-CE6AF925` builds the actual HVAC dispatcher home on the workspace-home substrate.

## Visual Paradigm

The recommended pattern is a **dispatch day board**:

- Top summary strip: hot counts only, sized for scan speed.
- Left column: jobs that need a decision, especially unassigned, emergency, parts-blocked, and unconfirmed calls.
- Center: technician/truck lanes with current job, next job, load, and truck-stock hints.
- Right: customer/site map with route-risk callouts.
- Lower row: truck stock, failed customer updates, and coworker handoffs.

This intentionally puts queue, map, technician load, inventory, and communication exceptions above generic business metrics.

## Research Anchors

- [ServiceTitan Dispatching Home](https://help.servicetitan.com/docs/dispatching) centers office staff on technician schedules, job appointments, dispatch boards, job trays, alerts, holds, and cancellations.
- [ServiceTitan Job Tray documentation](https://help.servicetitan.com/v1/docs/use-the-job-tray-on-the-new-daily-and-weekly-dispatch-board) treats unassigned appointments and alerts as high-attention tabs.
- [Housecall Pro Schedule documentation](https://help.housecallpro.com/en/articles/6367496-how-to-use-the-schedule-tab-calendar) emphasizes unscheduled jobs, dispatch/calendar views, employee availability, and map/calendar workflows.
- [Jobber routing documentation](https://help.getjobber.com/hc/en-us/articles/360033836293-How-to-Route) distinguishes master routes from daily map-based route adjustments.
- [OCA Field Service](https://github.com/OCA/field-service) shows field-service modules around orders, activities, agreements, calendar, equipment stock, recurring work, routes, skills, stock, timesheets, and vehicles.

## Implementation Implications

`BI-CE6AF925` should treat this as the target first viewport:

- Required slots: dispatch queue, technician lanes, customer/site map, truck stock, failed customer updates, coworker handoffs.
- Required primitives from `BI-5B8FE5C1`: queue, map, schedule/capacity, inventory/restock, communication exception, coworker handoff.
- Required vocabulary: jobs, service calls, techs, trucks, parts, warehouse, customers, on-my-way, restock.
- Avoided vocabulary: platform substrate, build IDs, GearInterface, ring, torque, slip, cockpit, calibration, contribution model.

## Open Design Questions

1. Should technician lanes be horizontally scrollable on tablet, or collapsed into a prioritized list?
2. Should the customer/site map be visible by default on mobile, or behind a "Map" tab after the hot queue?
3. Should truck-stock exceptions be shown as a shared shop list first, or attached primarily to each truck lane?

These should be resolved in the Dale design pass before implementation begins.
