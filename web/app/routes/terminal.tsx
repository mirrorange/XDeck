import { AppHeader } from "~/components/app-header";
import { TerminalPage } from "~/components/terminal/TerminalPage";

export function meta() {
  return [
    { title: "Terminal — XDeck" },
    { name: "description", content: "Web terminal sessions" },
  ];
}

export default function TerminalRoute() {
  return (
    <>
      <AppHeader title="Terminal" />
      <div className="flex-1 overflow-hidden">
        <TerminalPage />
      </div>
    </>
  );
}
