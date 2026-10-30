import type { Metadata } from "next";

import { PhotoshootStudio } from "../../components/photoshoot/photoshoot-studio";
import { APP_NAME, SURFACES } from "../../lib/brand";
import "./photoshoot.css";

export const metadata: Metadata = { title: `${SURFACES.photoshoot.label} · ${APP_NAME}` };

/** `?run=<id>` (from /runs) reopens that run; otherwise the tab's last run resumes. */
export default async function PhotoshootPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { run } = await searchParams;
  return <PhotoshootStudio runId={typeof run === "string" && run ? run : undefined} />;
}
