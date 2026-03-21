"use client";

type Props = {
  messages: Array<{ text: string }>;
};

export function StaticCOOPanel({ messages }: Props) {
  return (
    <div className="flex flex-col h-full bg-gray-50 border-l">
      <div className="px-4 py-3 border-b bg-white">
        <h3 className="text-sm font-semibold text-gray-900">Onboarding COO</h3>
        <p className="text-xs text-gray-500">Your AI operations officer</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className="bg-white rounded-lg p-3 shadow-sm border text-sm text-gray-700 leading-relaxed">
            {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}
