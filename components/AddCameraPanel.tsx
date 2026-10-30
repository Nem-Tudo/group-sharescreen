"use client";

import { useEffect, useState } from "react";
import { MdAdd, MdPhoneIphone, MdVideocam } from "react-icons/md";
import { NewBadge } from "@/components/NewBadge";
import { QrCode } from "@/components/PhoneCameraPanel";
import { trackFeatureEvent } from "@/lib/features";
import { MULTI_CAMERA_FEATURE, type ExtraCameraSource } from "@/lib/multiCamera";
import {
  PHONE_CAMERA_EVENTS,
  phoneCameraLinkUrl,
  rejectPhoneCameraClaim,
  requestPhoneCameraLink,
  submitPhoneCameraCode,
  takePhoneCameraHere,
  usePhoneCamera,
} from "@/lib/phoneCamera";
import { useT } from "@/lib/useI18n";

// The panel of the "+" beside the camera button ("Várias câmeras", see
// lib/multiCamera.ts): what can be added — the other webcams of this
// computer, the saved phones not already in use, a new phone through the QR
// — and every camera going out, each closable on its own.

export interface AddCameraItem {
  id: string;
  label: string;
  phone: boolean;
  /** Still waiting for the phone to answer. */
  waiting?: boolean;
  onStop: () => void;
}

const option =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800";

export function AddCameraPanel({
  count,
  limit,
  upgrade,
  webcams,
  phones,
  onAdd,
  items,
}: {
  count: number;
  limit: number;
  // The next plan with a higher limit, null on the top one.
  upgrade: { planName: string; limit: number; onClick: () => void } | null;
  // This computer's cameras not going out yet.
  webcams: { deviceId: string; label: string }[];
  // The saved phones not in use yet; null where phones are not offered.
  phones: { deviceId: string; name: string; online: boolean }[] | null;
  onAdd: (source: ExtraCameraSource) => void;
  items: AddCameraItem[];
}) {
  const t = useT();
  const phone = usePhoneCamera();
  const [linking, setLinking] = useState(false);
  const [code, setCode] = useState("");
  const atLimit = count >= limit;

  // The QR, for a phone that becomes one more camera (linkFor "extra"):
  // saved always, a one-time phone has no id to tell it from the others.
  useEffect(() => {
    if (!linking || !phone.connected) return;
    requestPhoneCameraLink("save", false, "extra");
  }, [linking, phone.connected]);

  // A confirmed phone closes the QR: useRoomMedia already added it.
  const [seenPairedAt, setSeenPairedAt] = useState(phone.pairedAt);
  if (seenPairedAt !== phone.pairedAt) {
    setSeenPairedAt(phone.pairedAt);
    setLinking(false);
    setCode("");
  }

  const claim = linking ? (phone.claims[phone.claims.length - 1] ?? null) : null;
  const url = phone.link && phone.link.mode === "save" && phone.linkFor === "extra" ? phoneCameraLinkUrl(phone.link.token) : null;

  return (
    <div className="flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-2 p-2 text-zinc-800 dark:text-zinc-200">
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
        {atLimit
          ? t("watch.watchRoom.cameraLimitReached", { limit })
          : t("watch.watchRoom.addAnotherCamera", { count, limit })}
        <NewBadge id={MULTI_CAMERA_FEATURE} />
      </span>

      {atLimit && upgrade && (
        <button
          type="button"
          onClick={upgrade.onClick}
          className="flex w-full flex-col gap-1 rounded-lg border border-amber-400/50 bg-amber-400/10 p-2 text-left text-xs transition hover:bg-amber-400/20"
        >
          <span className="font-semibold">
            {t("watch.watchRoom.upgradeCamerasTitle", { plan: upgrade.planName, limit: upgrade.limit })}
          </span>
          <span className="mt-0.5 block w-full rounded-md bg-amber-500 py-1 text-center font-semibold text-white">
            {t("watch.watchRoom.seePlans")} →
          </span>
        </button>
      )}

      {!atLimit && (
        <>
          <div className="flex flex-col gap-0.5">
            <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              {t("watch.watchRoom.multiCameraWebcams")}
            </span>
            {webcams.length === 0 ? (
              <span className="px-2 py-1 text-xs text-zinc-500">{t("watch.watchRoom.multiCameraNoWebcam")}</span>
            ) : (
              webcams.map((cam) => (
                <button
                  key={cam.deviceId}
                  type="button"
                  className={option}
                  onClick={() => onAdd({ kind: "webcam", deviceId: cam.deviceId, label: cam.label })}
                >
                  <MdVideocam className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{cam.label}</span>
                  <MdAdd className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              ))
            )}
          </div>

          {phones && (
            <div className="flex flex-col gap-0.5">
              <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {t("watch.watchRoom.multiCameraPhones")}
              </span>
              {phone.replaced ? (
                <div className="flex flex-col gap-1.5 px-2 text-xs text-zinc-600 dark:text-zinc-400">
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
                <span className="px-2 py-1 text-xs text-zinc-500">{t("watch.watchRoom.phoneCameraConnecting")}</span>
              ) : (
                <>
                  {phones.map((p) => (
                    <button
                      key={p.deviceId}
                      type="button"
                      className={option}
                      onClick={() => onAdd({ kind: "phone", deviceId: p.deviceId, name: p.name })}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${p.online ? "bg-emerald-400" : "bg-zinc-400"}`}
                      />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <MdAdd className="h-4 w-4 shrink-0 opacity-70" />
                    </button>
                  ))}

                  {claim && (
                    <form
                      className="flex flex-col gap-1.5 rounded-md border border-blue-500/40 bg-blue-500/10 p-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (code.length !== 6) return;
                        submitPhoneCameraCode(claim.conn, code);
                      }}
                    >
                      <span className="text-xs font-medium">
                        {t("watch.watchRoom.phoneCameraTypeCode", {
                          name: claim.name || t("watch.watchRoom.phoneCameraPhone"),
                        })}
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
                      {url ? (
                        <>
                          <QrCode text={url} />
                          <span className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                            {t("watch.watchRoom.phoneCameraScanSave")}
                          </span>
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
                      className="mt-0.5 flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                    >
                      <MdPhoneIphone className="h-4 w-4" />
                      {t("watch.watchRoom.multiCameraLinkPhone")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 px-2 text-xs">
              {item.phone ? (
                <MdPhoneIphone className="h-3.5 w-3.5 shrink-0 opacity-70" />
              ) : (
                <MdVideocam className="h-3.5 w-3.5 shrink-0 opacity-70" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {item.label}
                {item.waiting && <span className="ml-1 text-zinc-500">· {t("watch.watchRoom.multiCameraWaiting")}</span>}
              </span>
              <button
                type="button"
                onClick={item.onStop}
                aria-label={`${t("watch.watchRoom.stopThisCamera")}: ${item.label}`}
                className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white transition hover:bg-red-700"
              >
                {t("watch.watchRoom.closeScreen")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
