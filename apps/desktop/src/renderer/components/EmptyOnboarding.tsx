import React, { useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, Chrome } from 'lucide-react';
import type { AppConfig } from '@ai-quota/shared';

interface EmptyOnboardingProps {
  config: AppConfig | null;
  onCopyToken: (token: string) => void;
  onRescanCli: () => void;
}

export const EmptyOnboarding: React.FC<EmptyOnboardingProps> = ({
  config,
  onCopyToken,
  onRescanCli,
}) => {
  const [copied, setCopied] = useState(false);
  const token = config?.pairingToken ?? '----';

  const handleCopy = () => {
    if (!config?.pairingToken) return;
    onCopyToken(config.pairingToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="glass-card rounded-xl p-4 space-y-3.5 text-center">
      <div className="w-10 h-10 mx-auto rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
        <Chrome className="w-5 h-5" />
      </div>

      <div className="space-y-1">
        <h2 className="text-[0.95rem] font-semibold text-slate-100">等待自動探索 AI 帳號</h2>
        <p className="text-[0.8rem] text-slate-400 leading-relaxed">
          開箱即用，無須手動建立清單。連接 Chrome 擴充套件後，打開 Claude、Gemini 或 ChatGPT 頁面 3 秒內將自動出現卡片。
        </p>
      </div>

      <div className="rounded-lg bg-black/35 border border-white/10 p-2.5 space-y-1.5">
        <div className="flex items-center justify-center gap-1.5 text-[0.74rem] text-slate-400">
          <KeyRound className="w-3.5 h-3.5 text-amber-300" />
          <span>本機專屬配對碼（127.0.0.1:{config?.port ?? 17321}）</span>
        </div>
        <div className="flex items-center justify-center gap-2">
          <code className="text-base font-bold tracking-[0.2em] text-amber-200 font-mono">
            {token}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[0.78rem] text-slate-100 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? '已複製' : '複製'}</span>
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onRescanCli}
        className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-indigo-500/25 hover:bg-indigo-500/35 border border-indigo-400/30 text-[0.82rem] font-medium text-indigo-100 transition-colors cursor-pointer"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>立即掃描本機 Gemini / Antigravity CLI</span>
      </button>
    </div>
  );
};
