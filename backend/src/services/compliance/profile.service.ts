import { prisma } from "../../models/prisma";

export const WDM_DEFAULT = {
  name: "WDM Desk",
  entityType: "WDM participant (Wholesale Debt Market)",
  wdmSegment: true,
  registrations: ["SEBI-Registered Intermediary - WDM"],
  products: ["G-Sec", "Corporate Bonds", "Commercial Paper", "NDS-OM", "Debt Securities"],
  raw: {
    description:
      "Wholesale Debt Market participant dealing in government securities, corporate bonds, CP, and NDS-OM. Applicable if circular mentions debt market, WDM, G-Sec, corporate bonds, debt securities, NDS-OM, or SEBI debt regulations.",
  },
};

export async function getOrCreateProfile(userId: string, overrides?: Partial<typeof WDM_DEFAULT>) {
  const existing = await prisma.companyProfile.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.companyProfile.create({
    data: {
      userId,
      name: overrides?.name ?? WDM_DEFAULT.name,
      entityType: overrides?.entityType ?? WDM_DEFAULT.entityType,
      wdmSegment: overrides?.wdmSegment ?? WDM_DEFAULT.wdmSegment,
      registrations: overrides?.registrations ?? WDM_DEFAULT.registrations,
      products: overrides?.products ?? WDM_DEFAULT.products,
      raw: overrides?.raw ?? WDM_DEFAULT.raw,
    },
  });
}

export async function listProfiles(userId: string) {
  return prisma.companyProfile.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function updateProfile(userId: string, id: string, data: Partial<typeof WDM_DEFAULT>) {
  const existing = await prisma.companyProfile.findFirst({ where: { id, userId } });
  if (!existing) throw Object.assign(new Error("Profile not found"), { status: 404 });
  return prisma.companyProfile.update({
    where: { id },
    data: {
      name: data.name,
      entityType: data.entityType,
      wdmSegment: data.wdmSegment,
      registrations: data.registrations,
      products: data.products,
      raw: data.raw as any,
    },
  });
}
