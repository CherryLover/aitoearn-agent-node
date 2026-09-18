import { useEffect, useRef, useState } from "react";
import { Send, Square, Loader2, Check, X } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore, type ChatMessage } from "./store";
import type { BackgroundEvent } from "@/shared/messages";

export default function ChatPane() {
  const store = useChatStore();
  const { messages, running, error, init, send, stop, applyEvent, watchAuth } = store;
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void init();
    const listener = (event: BackgroundEvent) => {
      if (event && typeof event === "object" && "conversationId" in event) applyEvent(event);
    };
    chrome.runtime.onMessage.addListener(listener);
    const unwatch = watchAuth();
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      unwatch();
    };
  }, [init, applyEvent, watchAuth]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    void send(draft);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="mt-16 text-center text-sm text-zinc-500">
            <p>还没有对话</p>
            <p className="mt-1 text-xs">说一句话试试，比如「打开小红书，搜索 aitoearn」</p>
          </div>
        )}
        <div className="space-y-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
        {error && (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            rows={1}
            value={draft}
            placeholder="让它做点什么…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {running ? (
            <button
              className="rounded-md bg-zinc-200 p-2 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              onClick={() => void stop()}
              title="停止"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              className="rounded-md bg-zinc-900 p-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              onClick={submit}
              disabled={!draft.trim()}
              title="发送"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {message.tools?.map((tool) => (
        <div key={tool.toolCallId} className="flex items-center gap-1.5 text-xs text-zinc-500" title={tool.detail}>
          {tool.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
          {tool.status === "done" && <Check className="h-3 w-3 text-emerald-600" />}
          {tool.status === "error" && <X className="h-3 w-3 text-red-600" />}
          <span>{tool.name}</span>
        </div>
      ))}
      {message.text ? (
        <div className="prose-chat text-sm leading-relaxed">
          <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          {message.thinking ? "思考中" : "等模型回话"}
        </div>
      )}
    </div>
  );
}

