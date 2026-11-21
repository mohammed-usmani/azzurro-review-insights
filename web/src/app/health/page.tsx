import type { Metadata } from "next";
import { HealthPage } from "@/components/HealthPage";

export const metadata: Metadata = { title: "Data health" };

export default function Health() {
  return <HealthPage />;
}
