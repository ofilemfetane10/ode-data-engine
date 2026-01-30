"use client";

import { useEffect, useState } from "react";

export default function InstallButton() {
  const [promptEvent, setPromptEvent] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // detect if already installed (PWA)
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      // @ts-ignore
      window.navigator?.standalone === true;

    if (isStandalone) setInstalled(true);

    const onBeforeInstall = (e: any) => {
      e.preventDefault();
      setPromptEvent(e);
    };

    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const onInstall = async () => {
    if (!promptEvent) return;
    promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
  };

  // Always render a button so UI doesn't "disappear"
  const disabled = installed || !promptEvent;

  return (
    <button
      onClick={onInstall}
      disabled={disabled}
      title={
        installed
          ? "ODE is already installed"
          : !promptEvent
          ? "Install becomes available when your browser detects ODE as installable"
          : "Install ODE"
      }
      className={[
        "rounded-md border px-3 py-2 text-sm font-medium transition",
        installed
          ? "border-neutral-200 text-neutral-400 cursor-not-allowed"
          : disabled
          ? "border-neutral-200 text-neutral-400 cursor-not-allowed"
          : "border-red-500 text-red-600 hover:bg-red-50",
      ].join(" ")}
    >
      {installed ? "Installed" : "Install ODE"}
    </button>
  );
}
