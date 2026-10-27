"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MdCameraswitch,
  MdClose,
  MdFlashlightOff,
  MdFlashlightOn,
  MdPhoneIphone,
  MdVideocam,
  MdVideocamOff,
} from "react-icons/md";
import { MenuToggleRow } from "@/components/MenuToggleRow";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import { setTileExperimentMode } from "@/lib/clipsMode";
import { trackFeatureEvent } from "@/lib/features";
import {
  cancelPhoneCameraRequest,
  PHONE_CAMERA_EVENTS,
  PHONE_CAMERA_FEATURE,
  phoneCameraLinkUrl,
  rejectPhoneCameraClaim,
  removePhoneCameraDevice,
  requestPhoneCameraLink,
  sendPhoneCameraCommand,
  setPhoneCameraSource,
  submitPhoneCameraCode,
  takePhoneCameraHere,
  usePhoneCamera,
} from "@/lib/phoneCamera";
import { encodeQr } from "@/lib/qrCode";
import { copyText } from "@/lib/clipboard";
import { useT } from "@/lib/useI18n";

// "Celular como câmera" in the camera's panel (the arrow beside the camera
// button): the switch, and behind it which camera the room gets — the
// webcam or one of the saved phones — plus the QR code that links a new
// phone and the box where its code is typed. See lib/phoneCamera.

function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    const matrix = encodeQr(text);
    if (!matrix) return null;
    let d = "";
    matrix.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      })
    );
    return { d, size: matrix.length + 8 };
  }, [text]);
  if (!path) return null;
  return (
    <svg
      viewBox={`0 0 ${path.size} ${path.size}`}
      className="h-44 w-44 rounded-lg bg-white"
      shapeRendering="crispEdges"
      role="img"
      aria-label={text}
    >
      <path d={path.d} fill="#000" />
    </svg>
  );
}

// One of the phone's own controls, pressed from here.
function RemoteButton({
  onClick,
  label,
  active = false,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : "bg-white text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function OptionRow({
  selected,
  onClick,
  label,
  status,
  onRemove,
  removeLabel,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  status?: "online" | "offline";
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition ${
          selected
            ? "bg-emerald-600 text-white"
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        }`}
      >
        {status && (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${status === "online" ? "bg-emerald-400" : "bg-zinc-400"}`}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-800"
        >
          <MdClose className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function PhoneCameraPanel({ on }: { on: boolean }) {
  const t = useT();
  const phone = usePhoneCamera();
  const [linking, setLinking] = useState(false);
  const [mode, setMode] = useState<"once" | "save">("save");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  // Asking for the link again whenever the mode changes while the QR is up.
  useEffect(() => {
    if (!on || !linking || !phone.connected) return;
    requestPhoneCameraLink(mode);
  }, [on, linking, mode, phone.connected]);

  // A confirmed phone closes the QR: it did its job.
  const [seenPairedAt, setSeenPairedAt] = useState(phone.pairedAt);
  if (seenPairedAt !== phone.pairedAt) {
    setSeenPairedAt(phone.pairedAt);
    setLinking(false);
    setCode("");
  }

  const claim = phone.claims[phone.claims.length - 1] ?? null;
  const onceOnline = phone.online.find((o) => o.deviceId === null) ?? null;
  const session = phone.session;
  const url = phone.link ? phoneCameraLinkUrl(phone.link.token) : null;

  return (
    <div className="flex flex-col">
      <MenuToggleRow
        label={t("watch.watchRoom.phoneCamera")}
        badge={<NewBadge id={PHONE_CAMERA_FEATURE} />}
        active={on}
        onToggle={() => setTileExperimentMode("phoneCamera", !on)}
        hint={t("watch.watchRoom.phoneCameraHint")}
        activeIcon={<MdPhoneIphone className="h-4 w-4" />}
        inactiveIcon={<MdPhoneIphone className="h-4 w-4 opacity-50" />}
      />
      {on && (
        <div className="flex flex-col gap-2 px-2 pb-2">
          {phone.replaced ? (
            <div className="flex flex-col gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              <span>{t("watch.watchRoom.phoneCameraOtherTab")}</span>
              <button
                type="button"
                onClick={takePhoneCameraHere}
                className="rounded-md bg-emerald-600 px-2 py-1 font-semibold text-white transition hover:bg-emerald-700"
              >
                {t("watch.watchRoom.phoneCameraUseHere")}
              </button>
            </div>
          ) : !phone.connected ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("watch.watchRoom.phoneCameraConnecting")}</span>
          ) : (
            <>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("watch.watchRoom.phoneCameraSource")}</span>
              <div className="flex flex-col gap-1">
                <OptionRow
                  selected={!phone.source}
                  onClick={() => setPhoneCameraSource(null)}
                  label={t("watch.watchRoom.phoneCameraWebcam")}
                />
                {phone.devices.map((device) => (
                  <OptionRow
                    key={device.deviceId}
                    selected={phone.source === device.deviceId}
                    onClick={() => setPhoneCameraSource(device.deviceId)}
                    label={device.name}
                    status={phone.online.some((o) => o.deviceId === device.deviceId) ? "online" : "offline"}
                    onRemove={() => {
                      if (window.confirm(t("watch.watchRoom.phoneCameraRemoveConfirm", { name: device.name }))) {
                        removePhoneCameraDevice(device.deviceId);
                      }
                    }}
                    removeLabel={t("watch.watchRoom.phoneCameraRemove")}
                  />
                ))}
                {(onceOnline || phone.source === "once") && (
                  <OptionRow
                    selected={phone.source === "once"}
                    onClick={() => setPhoneCameraSource("once")}
                    label={`${onceOnline?.name || t("watch.watchRoom.phoneCameraPhone")} · ${t("watch.watchRoom.phoneCameraOnce")}`}
                    status={onceOnline ? "online" : "offline"}
                  />
                )}
              </div>

              {session && (
                <div className="flex flex-col gap-1.5 rounded-md bg-zinc-100 px-2 py-1.5 text-xs dark:bg-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {session.status === "live"
                        ? session.phone && !session.phone.camera
                          ? t("watch.watchRoom.phoneCameraPausedOnPhone", { name: session.name })
                          : t("watch.watchRoom.phoneCameraLive", { name: session.name })
                        : session.status === "waiting"
                          ? t("watch.watchRoom.phoneCameraWaiting", { name: session.name })
                          : session.status === "asking"
                            ? t("watch.watchRoom.phoneCameraAsking", { name: session.name })
                            : t("watch.watchRoom.phoneCameraConnectingPhone", { name: session.name })}
                    </span>
                    {session.status !== "live" && (
                      <button
                        type="button"
                        onClick={cancelPhoneCameraRequest}
                        className="shrink-0 rounded px-1.5 py-0.5 font-semibold text-red-600 hover:bg-red-600/10"
                      >
                        {t("watch.watchRoom.phoneCameraCancel")}
                      </button>
                    )}
                  </div>
                  {/* The phone's own controls, mirrored: what is pressed here
                      happens on the phone, and the phone's answer is what
                      these show. */}
                  {session.status === "live" && session.phone && (
                    <div className="flex gap-1">
                      <RemoteButton
                        onClick={() => sendPhoneCameraCommand("camera")}
                        label={session.phone.camera ? t("cam.cameraOff") : t("cam.cameraOn")}
                        active={!session.phone.camera}
                      >
                        {session.phone.camera ? <MdVideocam className="h-4 w-4" /> : <MdVideocamOff className="h-4 w-4" />}
                      </RemoteButton>
                      <RemoteButton onClick={() => sendPhoneCameraCommand("flip")} label={t("cam.flip")}>
                        <MdCameraswitch className="h-4 w-4" />
                      </RemoteButton>
                      {session.phone.torchSupported && (
                        <RemoteButton
                          onClick={() => sendPhoneCameraCommand("torch")}
                          label={t("cam.flash")}
                          active={session.phone.torch}
                        >
                          {session.phone.torch ? (
                            <MdFlashlightOn className="h-4 w-4" />
                          ) : (
                            <MdFlashlightOff className="h-4 w-4" />
                          )}
                        </RemoteButton>
                      )}
                    </div>
                  )}
                </div>
              )}

              {claim && (
                <form
                  className="flex flex-col gap-1.5 rounded-md border border-blue-500/40 bg-blue-500/10 p-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (code.length !== 6) return;
                    submitPhoneCameraCode(claim.conn, code);
                    markFeatureUsed(PHONE_CAMERA_FEATURE);
                  }}
                >
                  <span className="text-xs font-medium">
                    {t("watch.watchRoom.phoneCameraTypeCode", { name: claim.name || t("watch.watchRoom.phoneCameraPhone") })}
                  </span>
                  <div className="flex gap-1">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      placeholder="000000"
                      className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-center font-mono text-sm tracking-[0.3em] text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                    <button
                      type="submit"
                      disabled={code.length !== 6}
                      className="rounded-md bg-emerald-600 px-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {t("watch.watchRoom.phoneCameraConfirm")}
                    </button>
                  </div>
                  {phone.codeWrong?.conn === claim.conn && (
                    <span className="text-xs text-red-600 dark:text-red-400">
                      {t("watch.watchRoom.phoneCameraWrongCode", { left: phone.codeWrong.left })}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      rejectPhoneCameraClaim(claim.conn);
                      setCode("");
                    }}
                    className="self-start text-xs text-zinc-500 underline hover:text-red-600"
                  >
                    {t("watch.watchRoom.phoneCameraNotMine")}
                  </button>
                </form>
              )}

              {linking ? (
                <div className="flex flex-col items-center gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
                  <div className="flex w-full gap-1">
                    {(["save", "once"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={mode === m}
                        onClick={() => setMode(m)}
                        className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                          mode === m
                            ? "bg-emerald-600 text-white"
                            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {m === "save" ? t("watch.watchRoom.phoneCameraModeSave") : t("watch.watchRoom.phoneCameraModeOnce")}
                      </button>
                    ))}
                  </div>
                  {url && phone.link?.mode === mode ? (
                    <>
                      <QrCode text={url} />
                      <span className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                        {mode === "save"
                          ? t("watch.watchRoom.phoneCameraScanSave")
                          : t("watch.watchRoom.phoneCameraScanOnce")}
                      </span>
                      <div className="flex w-full gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void copyText(url).then(() => {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1500);
                            });
                          }}
                          className="flex-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          {copied ? t("watch.watchRoom.phoneCameraCopied") : t("watch.watchRoom.phoneCameraCopy")}
                        </button>
                        {mode === "save" && (
                          <button
                            type="button"
                            onClick={() => requestPhoneCameraLink("save", true)}
                            title={t("watch.watchRoom.phoneCameraNewLinkHint")}
                            className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                          >
                            {t("watch.watchRoom.phoneCameraNewLink")}
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="py-8 text-xs text-zinc-500">{t("watch.watchRoom.phoneCameraConnecting")}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setLinking(false)}
                    className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    {t("watch.watchRoom.phoneCameraClose")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setLinking(true);
                    trackFeatureEvent(PHONE_CAMERA_EVENTS.qrOpen);
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                >
                  <MdPhoneIphone className="h-4 w-4" />
                  {t("watch.watchRoom.phoneCameraLink")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
