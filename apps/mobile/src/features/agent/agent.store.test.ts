import { useAgentStore } from "./agent.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetThread = jest.fn();
const mockSendMessage = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    agent: {
      getThread: (...args: unknown[]) => mockGetThread(...args),
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const fakeThread = {
  threadId: "thread-1",
  messages: [
    {
      id: "msg-1",
      role: "user",
      content: "Hello",
      agentId: null,
      routeContext: null,
      createdAt: "2026-03-19T00:00:00Z",
    },
    {
      id: "msg-2",
      role: "assistant",
      content: "Hi! How can I help?",
      agentId: "workspace-guide",
      routeContext: null,
      createdAt: "2026-03-19T00:00:01Z",
    },
  ],
};

const fakeSendResponse = {
  id: "msg-3",
  role: "user",
  content: "What is my portfolio?",
  agentId: null,
  routeContext: "portfolio",
  createdAt: "2026-03-19T00:01:00Z",
  threadId: "thread-1",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  useAgentStore.setState({
    messages: [],
    isStreaming: false,
    currentAgent: "workspace-guide",
    isOpen: false,
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("agent.store", () => {
  describe("fetchThread", () => {
    it("loads messages from API", async () => {
      mockGetThread.mockResolvedValue(fakeThread);

      await useAgentStore.getState().fetchThread();

      const state = useAgentStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].content).toBe("Hello");
      expect(state.messages[1].content).toBe("Hi! How can I help?");
    });

    it("keeps existing messages on failure", async () => {
      useAgentStore.setState({
        messages: [
          {
            id: "existing",
            role: "user",
            content: "Old message",
            agentId: null,
            routeContext: null,
            createdAt: "2026-03-19T00:00:00Z",
          },
        ],
      });
      mockGetThread.mockRejectedValue(new Error("Network error"));

      await useAgentStore.getState().fetchThread();

      expect(useAgentStore.getState().messages).toHaveLength(1);
      expect(useAgentStore.getState().messages[0].content).toBe("Old message");
    });
  });

  describe("sendMessage", () => {
    it("optimistically adds user message then fetches thread", async () => {
      mockSendMessage.mockResolvedValue(fakeSendResponse);
      mockGetThread.mockResolvedValue({
        threadId: "thread-1",
        messages: [
          ...fakeThread.messages,
          {
            id: "msg-3",
            role: "user",
            content: "What is my portfolio?",
            agentId: null,
            routeContext: "portfolio",
            createdAt: "2026-03-19T00:01:00Z",
          },
          {
            id: "msg-4",
            role: "assistant",
            content: "Here is your portfolio...",
            agentId: "portfolio-advisor",
            routeContext: "portfolio",
            createdAt: "2026-03-19T00:01:01Z",
          },
        ],
      });

      await useAgentStore
        .getState()
        .sendMessage("What is my portfolio?", "portfolio");

      expect(mockSendMessage).toHaveBeenCalledWith({
        content: "What is my portfolio?",
        agentId: "workspace-guide",
        routeContext: "portfolio",
      });

      const state = useAgentStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.messages.length).toBeGreaterThanOrEqual(2);
    });

    it("removes optimistic message on failure", async () => {
      mockSendMessage.mockRejectedValue(new Error("Server error"));

      await useAgentStore.getState().sendMessage("Hello");

      const state = useAgentStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.isStreaming).toBe(false);
    });
  });

  describe("setAgent", () => {
    it("changes the current agent", () => {
      useAgentStore.getState().setAgent("portfolio-advisor");
      expect(useAgentStore.getState().currentAgent).toBe("portfolio-advisor");
    });
  });

  describe("togglePanel", () => {
    it("toggles the panel open state", () => {
      expect(useAgentStore.getState().isOpen).toBe(false);
      useAgentStore.getState().togglePanel();
      expect(useAgentStore.getState().isOpen).toBe(true);
      useAgentStore.getState().togglePanel();
      expect(useAgentStore.getState().isOpen).toBe(false);
    });
  });
});
