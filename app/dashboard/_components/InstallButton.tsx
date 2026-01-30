"use client";

import { useEffect, useState } from "react";

export default function InstallButton() {
  const [promptEvent, setPromptEvent] = useState<any>(null);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setPromptEvent(e);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const onInstall = async () => {
    if (!promptEvent) return;
    promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
  };

  if (!promptEvent) return null;

  return (
    <button
      onClick={onInstall}
      className="rounded-md border border-red-500 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
    >
      Install ODE
    </button>
  );
}
