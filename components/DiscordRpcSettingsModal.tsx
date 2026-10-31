"use client";

import { useId, useState } from "react";
import { FaDiscord, FaShieldAlt, FaUser, FaTv, FaSlidersH, FaCheck, FaPowerOff, FaGlobe, FaUsers, FaSignInAlt, FaKey } from "react-icons/fa";
import {
  useDiscordRpcSettings,
  getEffectiveDiscordClientId,
  type DiscordRpcSettings,
} from "@/lib/discordRpc";
import { useFeature } from "@/lib/features";
import { DISCORD_RPC_FEATURE } from "@/lib/discordRpc";
import { useT } from "@/lib/useI18n";
import { useAuth } from "@/lib/AuthContext";

export function DiscordRpcSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [settings, updateSettings] = useDiscordRpcSettings();
  const { enabled: featureAllowed } = useFeature(DISCORD_RPC_FEATURE, { track: false });
  const [customIdInput, setCustomIdInput] = useState(settings.customClientId || "");
  const [idSaved, setIdSaved] = useState(false);
  const { account } = useAuth();
  const canManageClientId = Boolean(
    account?.flags?.includes("DISCORD_RICH_PRESENCE_MANAGE") || account?.flags?.includes("ADMIN")
  );

  if (!open) return null;

  const currentClientId = getEffectiveDiscordClientId(settings);

  const handleSaveId = () => {
    updateSettings({ customClientId: customIdInput.trim() || undefined });
    setIdSaved(true);
    setTimeout(() => setIdSaved(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl text-white">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5865F2]/20 text-[#5865F2]">
              <FaDiscord className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Discord Rich Presence</h2>
              <p className="text-xs text-neutral-400">
                Mostre o status do Go Live no seu perfil do Discord
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 hover:bg-white/5 hover:text-white transition"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm">
          {/* Main switch */}
          <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
            <div className="flex items-start gap-3">
              <FaPowerOff className="mt-1 h-4 w-4 text-[#5865F2] shrink-0" />
              <div>
                <div className="font-semibold text-white">Ativar Rich Presence</div>
                <div className="text-xs text-neutral-400">
                  Mostra automaticamente quando você está com o app aberto ou em chamada
                </div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.enabled}
                onChange={(e) => updateSettings({ enabled: e.target.checked })}
              />
              <div className="peer h-6 w-11 rounded-full bg-neutral-700 peer-checked:bg-[#5865F2] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
            </label>
          </div>

          {/* Privacy mode */}
          <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
            <div className="flex items-start gap-3">
              <FaShieldAlt className="mt-1 h-4 w-4 text-emerald-400 shrink-0" />
              <div>
                <div className="font-semibold text-white">Ocultar salas e chamadas privadas</div>
                <div className="text-xs text-neutral-400">
                  Em salas com senha ou chamadas diretas (DM), esconde nomes e links, mostrando apenas &quot;Em chamada privada&quot;.
                </div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.hidePrivateDetails}
                onChange={(e) => updateSettings({ hidePrivateDetails: e.target.checked })}
              />
              <div className="peer h-6 w-11 rounded-full bg-neutral-700 peer-checked:bg-emerald-500 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
            </label>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
            <div className="flex items-start gap-3">
              <FaGlobe className="mt-1 h-4 w-4 text-[#5865F2] shrink-0" />
              <div>
                <div className="font-semibold text-white">Mostrar o nome em chamada pública</div>
                <div className="text-xs text-neutral-400">Exibe o nome da sala pública em que você está.</div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.showPublicRoomName}
                onChange={(e) => updateSettings({ showPublicRoomName: e.target.checked })}
              />
              <div className="peer h-6 w-11 rounded-full bg-neutral-700 peer-checked:bg-[#5865F2] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
            </label>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
            <div className="flex items-start gap-3">
              <FaUsers className="mt-1 h-4 w-4 text-[#5865F2] shrink-0" />
              <div>
                <div className="font-semibold text-white">Mostrar o nome em chamada em grupo</div>
                <div className="text-xs text-neutral-400">Exibe o nome do grupo e da sala de voz em que você está.</div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.showGroupName}
                onChange={(e) => updateSettings({ showGroupName: e.target.checked })}
              />
              <div className="peer h-6 w-11 rounded-full bg-neutral-700 peer-checked:bg-[#5865F2] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
            </label>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
            <div className="flex items-start gap-3">
              <FaSignInAlt className="mt-1 h-4 w-4 text-[#5865F2] shrink-0" />
              <div>
                <div className="font-semibold text-white">Botão para entrar</div>
                <div className="text-xs text-neutral-400">Adiciona um botão para a sala pública ou para o grupo, quando o nome dele estiver visível.</div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.showJoinButton}
                onChange={(e) => updateSettings({ showJoinButton: e.target.checked })}
              />
              <div className="peer h-6 w-11 rounded-full bg-neutral-700 peer-checked:bg-[#5865F2] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
            </label>
          </div>

          {/* Account info toggle */}
          <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
            <div className="flex items-start gap-3">
              <FaUser className="mt-1 h-4 w-4 text-sky-400 shrink-0" />
              <div>
                <div className="font-semibold text-white">Mostrar nome de usuário e perfil</div>
                <div className="text-xs text-neutral-400">
                  Exibe seu nome de usuário do Go Live e adiciona botão com link para seu perfil público.
                </div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.showAccountInfo}
                onChange={(e) => updateSettings({ showAccountInfo: e.target.checked })}
              />
              <div className="peer h-6 w-11 rounded-full bg-neutral-700 peer-checked:bg-sky-500 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
            </label>
          </div>

          {/* Screen & live streaming stats */}
          <div className="flex items-center justify-between rounded-xl bg-white/5 p-4 border border-white/5">
            <div className="flex items-start gap-3">
              <FaTv className="mt-1 h-4 w-4 text-purple-400 shrink-0" />
              <div>
                <div className="font-semibold text-white">Estatísticas de transmissão</div>
                <div className="text-xs text-neutral-400">
                  Mostra quando você estiver compartilhando tela, câmera ou com microfone ativo.
                </div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.showActivityStats}
                onChange={(e) => updateSettings({ showActivityStats: e.target.checked })}
              />
              <div className="peer h-6 w-11 rounded-full bg-neutral-700 peer-checked:bg-purple-500 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
            </label>
          </div>

          {/* Configurable Client ID from .env or override */}
          {canManageClientId && <div className="rounded-xl bg-white/5 p-4 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                <FaKey className="h-3 w-3 text-[#5865F2] shrink-0" />
                Discord Client ID (.env ou customizado)
              </div>
              <span className="text-[10px] text-neutral-500">
                Ativo: {currentClientId}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={currentClientId}
                value={customIdInput}
                onChange={(e) => setCustomIdInput(e.target.value)}
                className="w-full rounded-lg bg-neutral-800 border border-white/10 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#5865F2]"
              />
              <button
                type="button"
                onClick={handleSaveId}
                className="flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4752c4] transition shrink-0"
              >
                {idSaved ? (
                  <>
                    <FaCheck className="h-3 w-3" /> Salvo
                  </>
                ) : (
                  "Definir"
                )}
              </button>
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Por padrão, usa a variável de ambiente <code>NEXT_PUBLIC_DISCORD_CLIENT_ID</code> do <code>.env</code>.
            </p>
          </div>}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}

