import { AppHeader } from "~/components/app-header";
import { FileBrowser } from "~/components/files/file-browser";

export function meta() {
  return [
    { title: "Files — XDeck" },
    { name: "description", content: "Browse and manage files" },
  ];
}

export default function FilesPage() {
  return (
    <>
      <AppHeader title="Files" />
      <div className="flex-1 overflow-hidden">
        <FileBrowser />
      </div>
    </>
  );
}
