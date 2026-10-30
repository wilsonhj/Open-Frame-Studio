import type { Metadata } from "next";

import { PhotoshootStudio } from "../../components/photoshoot/photoshoot-studio";
import "./photoshoot.css";

export const metadata: Metadata = { title: "Photoshoot · Open Soul Studio" };

export default function PhotoshootPage() {
  return <PhotoshootStudio />;
}
