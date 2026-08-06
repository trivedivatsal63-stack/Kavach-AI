import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";

export function HomePage() {
  return (
    <Layout>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">AI API Platform</h1>
        <div className="flex gap-4">
          <Link to="/login" className="underline">
            Log in
          </Link>
          <Link to="/signup" className="underline">
            Sign up
          </Link>
          <Link to="/docs" className="underline">
            Docs
          </Link>
        </div>
      </div>
    </Layout>
  );
}
