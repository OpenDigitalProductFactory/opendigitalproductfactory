import { describe, expect, it } from "vitest";
import {
  itemIdForSource,
  mapIndustryToStream,
  parseReadme,
} from "./ingest-500-agents";

const SAMPLE_README = `# 500+ AI Agent Projects

---

## Use Case Table

| Use Case                              | Industry         | Description                                              | Code Github                                                                                           |
| ------------------------------------- | ---------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **HIA (Health Insights Agent)**       | Healthcare       | analyses medical reports and provide health insights.    | [![GitHub](https://img.shields.io/badge/Code-GitHub-black)](https://github.com/harshhh28/hia.git)    |
| **Automated Trading Bot**             | Finance          | Automates stock trading with real-time market analysis.  | [![GitHub](https://img.shields.io/badge/Code-GitHub-black)](https://github.com/MingyuJ666/Stockagent) |
| **Real-Time Threat Detection Agent**  | Cybersecurity    | Identifies potential threats and mitigates attacks.      | [![GitHub](https://img.shields.io/badge/Code-GitHub-black)](https://github.com/NVISO/cyber-llm)      |

## Framework wise Usecases

---

### **Framework Name**: **CrewAI**

| Use Case                         | Industry                | Description                                                                                  | GitHub                                                                                                 |
| -------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 📧 Email Auto Responder Flow     | 🗣️ Communication        | Automates email responses based on predefined criteria.                                      | [![GitHub](https://img.shields.io/badge/GitHub-Repo-blue)](https://github.com/crewAIInc/email-flow)  |
| 📝 Meeting Assistant Flow        | 🛠️ Productivity         | Assists in organizing and managing meetings.                                                 | [![GitHub](https://img.shields.io/badge/GitHub-Repo-blue)](https://github.com/crewAIInc/meeting)     |

### **Framework Name**: **AutoGen**

| Use Case                | Industry       | Description                              | GitHub                                                                               |
| ----------------------- | -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Research Assistant      | Research       | Automates literature review.             | [![GitHub](https://img.shields.io/badge/Repo-blue)](https://github.com/autogen/ra) |
`;

describe("parseReadme", () => {
  it("extracts rows from the main Use Case Table", () => {
    const entries = parseReadme(SAMPLE_README);
    const main = entries.filter((e) => !e.framework);
    expect(main).toHaveLength(3);
    expect(main[0]).toMatchObject({
      name: "HIA (Health Insights Agent)",
      industry: "Healthcare",
      sourceUrl: "https://github.com/harshhh28/hia.git",
    });
    expect(main[1].industry).toBe("Finance");
    expect(main[2].name).toBe("Real-Time Threat Detection Agent");
  });

  it("tags framework rows with the correct framework identifier", () => {
    const entries = parseReadme(SAMPLE_README);
    const crewai = entries.filter((e) => e.framework === "crewai");
    const autogen = entries.filter((e) => e.framework === "autogen");

    expect(crewai).toHaveLength(2);
    expect(crewai[0].name).toContain("Email Auto Responder Flow");
    // Emoji prefix must be stripped from the industry label
    expect(crewai[0].industry).toBe("Communication");
    expect(autogen).toHaveLength(1);
    expect(autogen[0].sourceUrl).toBe("https://github.com/autogen/ra");
  });

  it("throws when no entries can be parsed (upstream format drift)", () => {
    expect(() => parseReadme("# no tables here\n\njust prose")).toThrow(
      /zero catalog entries/,
    );
  });
});

describe("mapIndustryToStream", () => {
  const seeded = new Set(["Evaluate", "Integrate", "Operate"]);

  it("returns mapped + seeded stream when the industry is a known alias", () => {
    const match = mapIndustryToStream("Cybersecurity", seeded);
    expect(match).toEqual({ stream: "Operate", confidence: "mapped" });
  });

  it("is case-insensitive on the industry label", () => {
    expect(mapIndustryToStream("DEVOPS", seeded).confidence).toBe("mapped");
    expect(mapIndustryToStream("  research  ", seeded).stream).toBe("Evaluate");
  });

  it("returns needs-mapping when the industry isn't in the starter mapping", () => {
    const match = mapIndustryToStream("Healthcare", seeded);
    expect(match).toEqual({ stream: null, confidence: "needs-mapping" });
  });

  it("returns needs-mapping when the mapped stream isn't seeded in the DB", () => {
    // "Coding" maps to "Integrate" in the starter mapping; remove it from
    // the seeded set and we should fall back to needs-mapping rather than
    // silently link to a nonexistent stream.
    const match = mapIndustryToStream("Coding", new Set(["Evaluate", "Operate"]));
    expect(match.confidence).toBe("needs-mapping");
  });
});

describe("itemIdForSource", () => {
  it("is deterministic for the same URL", () => {
    const a = itemIdForSource("https://github.com/foo/bar");
    const b = itemIdForSource("https://github.com/foo/bar");
    expect(a).toBe(b);
    expect(a.startsWith("HS-")).toBe(true);
  });

  it("differs for different URLs", () => {
    const a = itemIdForSource("https://github.com/foo/bar");
    const b = itemIdForSource("https://github.com/foo/baz");
    expect(a).not.toBe(b);
  });
});
