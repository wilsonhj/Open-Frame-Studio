import type { Metadata } from "next";

import { PhotoshootStudio } from "../../components/photoshoot/photoshoot-studio";
import { APP_NAME, SURFACES } from "../../lib/brand";
import "./photoshoot.css";

export const metadata: Metadata = { title: `${SURFACES.photoshoot.label} · ${APP_NAME}` };

export default function PhotoshootPage() {
  return <PhotoshootStudio />;
}
