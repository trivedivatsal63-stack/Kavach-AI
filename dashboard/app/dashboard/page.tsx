import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLiteLLMKeyUsage } from "@/lib/litellm";
import { ApiKeysPanel } from "./api-keys";
import { CreditsPanel } from "./credits-panel";
import { UsageTable, type UsageRow } from "./usage-table";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const [dbUser, apiKeys] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.user.id } }),
    prisma.apiKey.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Usage is pulled live from LiteLLM per key on every load — no local
  // usage ledger. If LiteLLM is briefly unreachable, fall back to zeros
  // for that key rather than failing the whole page.
  const usageRows: UsageRow[] = await Promise.all(
    apiKeys.map(async (k) => {
      const usage = await getLiteLLMKeyUsage(k.litellmKeyId).catch(() => ({
        totalSpend: 0,
        totalRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
      }));
      return {
        id: k.id,
        createdAt: k.createdAt.toISOString(),
        revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
        ...usage,
      };
    })
  );

  return (
    <div className="flex flex-1 flex-col items-center gap-10 px-4 py-16">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-2xl font-semibold">
          Welcome, {session.user.email}
        </h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="text-sm underline">
            Log out
          </button>
        </form>
      </div>

      <CreditsPanel balance={dbUser.creditBalanceUsd.toNumber()} />

      <ApiKeysPanel
        initialKeys={apiKeys.map((k) => ({
          id: k.id,
          createdAt: k.createdAt.toISOString(),
          revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
        }))}
      />

      <UsageTable rows={usageRows} />
    </div>
  );
}
