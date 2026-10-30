import type { Metadata } from "next";

import { MotionStudio } from "../../components/motion/motion-studio";
import { APP_NAME, SURFACES } from "../../lib/brand";

export const metadata: Metadata = { title: `${SURFACES.motion.label} · ${APP_NAME}` };

/** `?run=<id>` (from /runs) reopens that run; otherwise the tab's last run resumes. */
export default async function MotionPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { run } = await searchParams;
  return <MotionStudio runId={typeof run === "string" && run ? run : undefined} />;
}
