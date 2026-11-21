import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  // useSearchParams (filters in the URL) needs a Suspense boundary
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
