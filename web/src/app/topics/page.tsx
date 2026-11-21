import type { Metadata } from "next";
import { TopicsPage } from "@/components/TopicsPage";

export const metadata: Metadata = { title: "Topics and problems" };

export default function Topics() {
  return <TopicsPage />;
}
