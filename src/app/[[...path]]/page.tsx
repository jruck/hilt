import { Board } from "@/components/Board";

interface PageProps {
  params: Promise<{ path?: string[] }>;
}

export default async function Home({ params }: PageProps) {
  const { path } = await params;
  // Reconstruct the scope path from URL segments
  // e.g., ["Users", "jruck", "Work"] -> "/Users/jruck/Work"
  const scopePath = path ? `/${path.join("/")}` : "";

  return <Board initialScope={scopePath} />;
}
