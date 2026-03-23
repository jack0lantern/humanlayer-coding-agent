import { useState } from "react";

interface CreateSessionProps {
  onSubmit: (prompt: string) => void;
  isDisabled: boolean;
}

export function CreateSession({ onSubmit, isDisabled }: CreateSessionProps) {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isDisabled) {
      onSubmit(prompt.trim());
      setPrompt("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-3 border-t border-zinc-800">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe a coding task..."
        className="w-full bg-zinc-800 text-zinc-100 rounded-lg p-3 text-sm resize-none border border-zinc-700 focus:border-zinc-500 focus:outline-none placeholder-zinc-500"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            handleSubmit(e);
          }
        }}
      />
      <button
        type="submit"
        disabled={!prompt.trim() || isDisabled}
        className="mt-2 w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
      >
        {isDisabled ? "Agent Offline" : "Start Session"}
      </button>
    </form>
  );
}
