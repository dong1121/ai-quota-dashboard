import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Check,
  EyeOff,
  Pencil,
  X,
} from 'lucide-react';
import {
  ACCOUNT_COLOR_PRESETS,
  PROVIDER_META,
  type AccountDTO,
  type AccountUpdateInput,
  type ManualAdjustInput,
} from '@ai-quota/shared';
import { QuotaBar } from './QuotaBar.js';

interface AccountCardProps {
  account: AccountDTO;
  nowMs: number;
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
  onUpdateAccount: (input: AccountUpdateInput) => void;
  onMove: (direction: 'up' | 'down') => void;
  onManualAdjust: (input: ManualAdjustInput) => void;
}

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  nowMs,
  canReorder,
  isFirst,
  isLast,
  onUpdateAccount,
  onMove,
  onManualAdjust,
}) => {
  const providerMeta = PROVIDER_META[account.provider];
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(account.displayName);
  const [colorDraft, setColorDraft] = useState(account.colorTag || providerMeta.defaultColor);

  const openEditor = () => {
    setNameDraft(account.displayName);
    setColorDraft(account.colorTag || providerMeta.defaultColor);
    setEditing(true);
  };

  const handleSave = () => {
    onUpdateAccount({
      id: account.id,
      displayName: nameDraft.trim() || account.displayName,
      colorTag: colorDraft,
    });
    setEditing(false);
  };

  return (
    <section className="group glass-card rounded-xl p-3 space-y-2.5 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
            style={{
              backgroundColor: account.colorTag || providerMeta.defaultColor,
              boxShadow: `0 0 10px ${account.colorTag || providerMeta.defaultColor}88`,
            }}
          />
          <span className="text-[0.75rem] font-semibold uppercase tracking-wider text-slate-400 shrink-0">
            {providerMeta.badgeText}
          </span>
          <span className="text-[0.9rem] font-medium text-slate-100 truncate">
            {account.displayName}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {account.profileHint && !editing && (
            <span className="px-2 py-0.5 rounded-md bg-white/8 border border-white/10 text-[0.72rem] text-slate-300 max-w-[7.5rem] truncate group-hover:hidden">
              {account.profileHint}
            </span>
          )}

          {!editing && (
            <div className="hidden group-hover:flex items-center gap-0.5">
              {canReorder && !isFirst && (
                <button
                  type="button"
                  title="上移"
                  onClick={() => onMove('up')}
                  className="p-1 rounded hover:bg-white/12 text-slate-300 cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
              )}
              {canReorder && !isLast && (
                <button
                  type="button"
                  title="下移"
                  onClick={() => onMove('down')}
                  className="p-1 rounded hover:bg-white/12 text-slate-300 cursor-pointer"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                title={account.notifyEnabled ? '此帳號已開啟滿血通知（點擊靜音）' : '此帳號已靜音（點擊開啟）'}
                onClick={() =>
                  onUpdateAccount({ id: account.id, notifyEnabled: !account.notifyEnabled })
                }
                className={`p-1 rounded hover:bg-white/12 cursor-pointer ${
                  account.notifyEnabled ? 'text-sky-300' : 'text-slate-500'
                }`}
              >
                {account.notifyEnabled ? (
                  <Bell className="w-3.5 h-3.5" />
                ) : (
                  <BellOff className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                title="編輯別名、色標或隱藏"
                onClick={openEditor}
                className="p-1 rounded hover:bg-white/12 text-slate-300 hover:text-white cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline Account Customization Drawer */}
      {editing && (
        <div className="rounded-lg bg-black/40 border border-white/12 p-2.5 space-y-2.5 text-[0.78rem]">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="輸入自訂別名（如：家庭主力）"
              className="flex-1 px-2 py-1 rounded bg-white/8 border border-white/15 text-slate-100 focus:outline-none focus:border-sky-400"
            />
            <button
              type="button"
              onClick={handleSave}
              title="儲存"
              className="p-1.5 rounded bg-sky-500/30 hover:bg-sky-500/45 text-sky-100 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              title="取消"
              className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-300 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {ACCOUNT_COLOR_PRESETS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.name}
                  onClick={() => setColorDraft(c.hex)}
                  className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                    colorDraft === c.hex ? 'ring-2 ring-white scale-110' : 'opacity-75 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                onUpdateAccount({ id: account.id, isHidden: true });
                setEditing(false);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 text-[0.72rem] cursor-pointer"
            >
              <EyeOff className="w-3 h-3" />
              隱藏
            </button>
          </div>
        </div>
      )}

      {account.buckets.length > 0 ? (
        <div className="space-y-2.5 pt-0.5">
          {account.buckets.map((bucket) => (
            <QuotaBar
              key={bucket.id}
              bucket={bucket}
              nowMs={nowMs}
              onManualAdjust={onManualAdjust}
            />
          ))}
        </div>
      ) : (
        <p className="text-[0.8rem] text-slate-400 italic">已偵測帳號，等待首次額度回報…</p>
      )}
    </section>
  );
};
