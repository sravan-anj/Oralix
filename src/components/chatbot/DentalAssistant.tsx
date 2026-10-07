import React, { useEffect, useRef, useState } from 'react';
import { Send, X, Loader2, Sparkles, RotateCcw } from 'lucide-react';
import { supabase } from '../../utils/supabaseClient';

type ChatMessage = { role: 'user' | 'assistant'; text: string };

const STARTER: ChatMessage = {
  role: 'assistant',
  text: "Hello! 👋 I'm your Oralix AI dental assistant. Ask me how to use appointments, patients, billing, inventory, clinical notes, queue, reports, or the dental odontogram. I can also share general oral health guidance!",
};

const SUGGESTIONS = [
  '📅 How to book appointment?',
  '🦷 How to use Odontogram chart?',
  '💳 How to create billing invoice?',
  '✨ Advice for tooth sensitivity',
];

/**
 * DentalAssistant – Oralix Dental AI Assistant
 *
 * Styled to seamlessly harmonize with Oralix's warm ivory, champagne gold,
 * and clinical studio aesthetic. Features the friendly smiling tooth mascot
 * as the floating interactive launcher and chat companion.
 */
export function DentalAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([STARTER]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (overrideText?: string, event?: React.FormEvent) => {
    event?.preventDefault();
    const question = (overrideText || input).trim();
    if (!question || loading) return;

    const next: ChatMessage[] = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      // Retrieve the current Supabase session token
      let {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        const refresh = await supabase.auth.refreshSession();
        session = refresh.data?.session || null;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      } else {
        // Fallback for local development testing
        headers['Authorization'] = `Bearer dev-test-token`;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: next
            .filter((m, i) => !(i === 0 && m.role === 'assistant'))
            .map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      const raw = await response.text();
      let data: { reply?: string; error?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          `Assistant server returned an unexpected response (HTTP ${response.status}). Please verify that the server is running.`
        );
      }

      if (!response.ok) {
        throw new Error(data.error || `The assistant is unavailable (HTTP ${response.status}).`);
      }
      if (!data.reply) {
        throw new Error('The assistant returned an empty response. Please try again.');
      }

      setMessages((prev) => [...prev, { role: 'assistant', text: data.reply! }]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text:
            error instanceof Error
              ? error.message
              : 'Could not connect to the assistant. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleResetChat = () => {
    setMessages([STARTER]);
  };

  return (
    <>
      {/* =========================================================================
          ORALIX DENTAL CHAT WINDOW (Warm Ivory, Champagne, Dental Contour)
          ========================================================================= */}
      {open && (
        <section
          className="fixed bottom-24 right-4 sm:right-6 z-[100] w-[min(410px,calc(100vw-2rem))] h-[min(600px,calc(100vh-8rem))] rounded-[2rem] border-2 border-[#C8B58D]/45 bg-[#FBF9F5]/98 text-[#252525] shadow-[0_24px_65px_rgba(60,55,45,0.18)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 backdrop-blur-2xl font-sans"
          aria-label="Oralix Dental AI Assistant"
        >
          {/* Header with Smiley Dental Mascot */}
          <header className="relative px-4 py-3.5 border-b border-[#C8B58D]/30 bg-gradient-to-r from-[#EDE8DE] via-[#F6F3EC] to-[#EDE8DE] shrink-0 flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-3">
              {/* Smiley Tooth Mascot Avatar */}
              <div className="relative w-11 h-11 rounded-2xl bg-white border border-[#C8B58D]/40 p-1 flex items-center justify-center shadow-xs overflow-hidden group">
                <img
                  src="/smiley_dental_ai.png"
                  alt="Oralix Smiling Tooth Mascot"
                  className="w-9 h-9 object-contain drop-shadow-xs group-hover:scale-110 transition-transform duration-200"
                />
                <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white ring-1 ring-emerald-400" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <h2 className="font-display font-extrabold text-sm text-[#252525] tracking-tight">
                    Oralix Dental AI
                  </h2>
                  <span className="px-1.5 py-0.5 rounded-md bg-[#C8B58D]/25 text-[#695834] text-[9px] font-black uppercase tracking-wider">
                    Online
                  </span>
                </div>
                <p className="text-[11px] text-[#6F6D69] font-medium flex items-center gap-1">
                  <span>Clinical &amp; Smile Companion</span>
                  <Sparkles className="w-2.5 h-2.5 text-[#C8B58D]" />
                </p>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleResetChat}
                title="Restart conversation"
                aria-label="Restart conversation"
                className="p-1.5 rounded-xl text-[#6F6D69] hover:text-[#252525] hover:bg-white/80 transition-colors cursor-pointer"
              >
                <RotateCcw size={15} />
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="p-1.5 rounded-xl text-[#6F6D69] hover:text-[#252525] hover:bg-white/80 transition-colors cursor-pointer"
              >
                <X size={17} />
              </button>
            </div>
          </header>

          {/* Messages & Suggestion Area */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 bg-gradient-to-b from-[#F7F5F1]/60 via-[#FBF9F5] to-[#EDE8DE]/30">
            {/* Friendly Mascot Intro Banner (shown if starter message is alone) */}
            {messages.length === 1 && (
              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-white to-[#F5F2EB] border border-[#C8B58D]/30 shadow-2xs flex items-center gap-3">
                <img
                  src="/smiley_dental_ai.png"
                  alt="Smiley Tooth"
                  className="w-12 h-12 object-contain shrink-0 animate-tooth-float"
                />
                <div className="text-xs text-[#252525]">
                  <p className="font-bold text-[#252525]">
                    Happy to help with your clinic workflow!
                  </p>
                  <p className="text-[11px] text-[#6F6D69] mt-0.5 leading-snug">
                    Pick a suggestion below or type any question about Oralix or dental care.
                  </p>
                </div>
              </div>
            )}

            {/* Message Conversation Stream */}
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-2 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start items-start'
                }`}
              >
                {/* Assistant Mini Mascot Avatar */}
                {message.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-white border border-[#C8B58D]/40 p-0.5 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
                    <img
                      src="/smiley_dental_ai.png"
                      alt="Oralix AI"
                      className="w-5 h-5 object-contain"
                    />
                  </div>
                )}

                {/* Message Bubble */}
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                    message.role === 'user'
                      ? 'bg-gradient-to-r from-[#C8B58D] to-[#B8A378] text-[#252525] font-semibold rounded-tr-xs shadow-xs border border-[#C8B58D]/40'
                      : 'bg-white border border-stone-200/90 text-[#252525] rounded-tl-xs shadow-2xs'
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}

            {/* Loading Indicator */}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-[#6F6D69] px-2 pt-1">
                <div className="w-6 h-6 rounded-full bg-white border border-[#C8B58D]/40 p-0.5 flex items-center justify-center shrink-0 shadow-2xs">
                  <img
                    src="/smiley_dental_ai.png"
                    alt="Oralix AI"
                    className="w-5 h-5 object-contain animate-bounce"
                  />
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white border border-stone-200/90 shadow-2xs text-[#6F6D69]">
                  <Loader2 size={13} className="animate-spin text-[#C8B58D]" />
                  <span className="font-semibold text-[11px]">Thinking of the best response…</span>
                </div>
              </div>
            )}

            {/* Quick Suggestion Chips (when conversation is fresh) */}
            {messages.length === 1 && !loading && (
              <div className="pt-2">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#6F6D69] mb-2 px-1">
                  Quick Questions
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => sendMessage(item.replace(/^[^\w]+/, ''))}
                      className="px-2.5 py-1.5 rounded-xl bg-white/90 hover:bg-[#EDE8DE] border border-[#C8B58D]/30 text-[#252525] text-[11px] font-bold transition-all hover:scale-[1.02] cursor-pointer shadow-2xs"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input Form matching Oralix Warm Ivory controls */}
          <form
            onSubmit={(e) => sendMessage(undefined, e)}
            className="p-3 border-t border-stone-200/80 bg-white/95 shrink-0"
          >
            <div className="flex items-end gap-2 rounded-2xl bg-[#F7F5F1] border border-stone-200/90 focus-within:border-[#C8B58D] focus-within:ring-2 focus-within:ring-[#C8B58D]/25 p-2 transition-all">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Ask your dental or clinic question…"
                rows={1}
                className="flex-1 resize-none bg-transparent outline-none text-xs sm:text-sm text-[#252525] placeholder-[#999690] px-1.5 py-1 max-h-24 font-medium"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                aria-label="Send message"
                className="p-2 rounded-xl bg-gradient-to-r from-[#C8B58D] to-[#B8A378] hover:from-[#D6C49D] hover:to-[#C8B58D] text-[#252525] disabled:opacity-40 disabled:hover:from-[#C8B58D] shadow-xs hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0 font-bold"
              >
                <Send size={15} />
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-[#999690]">
              <span>Oralix AI Companion • Clinical guidance only</span>
              <span className="flex items-center gap-1 text-[#6F6D69] font-bold">
                <Sparkles size={11} className="text-[#C8B58D]" /> Powered by Gemini
              </span>
            </div>
          </form>
        </section>
      )}

      {/* =========================================================================
          FLOATING SMILEY DENTAL LAUNCHER BUTTON
          ========================================================================= */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close Oralix dental assistant' : 'Open Oralix dental assistant'}
        className="fixed bottom-5 right-5 sm:right-6 z-[100] group flex items-center gap-2.5 p-1.5 pr-4 rounded-full bg-white/95 border-2 border-[#C8B58D]/50 hover:border-[#C8B58D] shadow-[0_12px_35px_rgba(200,181,141,0.38)] hover:shadow-[0_16px_42px_rgba(200,181,141,0.48)] transition-all duration-300 hover:scale-[1.04] active:scale-[0.98] cursor-pointer backdrop-blur-md"
      >
        {/* Animated Smiley Tooth Emblem */}
        <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-[#EDE8DE] via-white to-[#EDE8DE] border border-[#C8B58D]/40 flex items-center justify-center overflow-hidden shadow-2xs group-hover:rotate-6 transition-transform duration-200">
          <img
            src="/smiley_dental_ai.png"
            alt="Oralix Smiley Tooth Mascot"
            className="w-10 h-10 object-contain drop-shadow-xs"
          />
          <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white ring-1 ring-emerald-400" />
        </div>

        {/* Text Label */}
        <div className="flex flex-col text-left">
          <div className="flex items-center gap-1">
            <span className="text-xs font-black tracking-tight text-[#252525] font-display">
              {open ? 'Close AI' : 'Ask Oralix AI'}
            </span>
            <Sparkles className="w-3 h-3 text-[#C8B58D]" />
          </div>
          <span className="text-[10px] font-semibold text-[#6F6D69] -mt-0.5">
            Dental Assistant
          </span>
        </div>

        {/* Close indicator when active */}
        {open && (
          <div className="w-6 h-6 rounded-full bg-[#EDE8DE] text-[#252525] flex items-center justify-center ml-1 border border-[#C8B58D]/30">
            <X size={14} />
          </div>
        )}
      </button>
    </>
  );
}
