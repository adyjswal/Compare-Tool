import { useEffect, useState } from "react";
import type { DiffResultMessage } from "../src/protocol";
import { getVsCodeApi } from "./vscodeApi";
import { Header } from "./Header";
import { DiffList } from "./DiffList";

export function App() {
  const [data, setData] = useState<DiffResultMessage | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string } | undefined;
      if (message?.type === "diffResult") {
        setData(message as DiffResultMessage);
      }
    };
    window.addEventListener("message", onMessage);

    // Tell the host we've mounted; it will (re)send the pending result.
    getVsCodeApi().postMessage({ type: "ready" });

    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!data) {
    return <div className="placeholder">Comparing…</div>;
  }

  return (
    <div className="app">
      <Header data={data} />
      <DiffList rows={data.rows} />
    </div>
  );
}
