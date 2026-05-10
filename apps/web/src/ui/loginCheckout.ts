export type PaidPlanId = 'nummer' | 'starter' | 'pro' | 'agency';
export type CheckoutInterval = 'month' | 'year';

export type CheckoutSignupForm = {
  orgName: string;
  email: string;
  phone: string;
  password: string;
};

export type StartCheckoutSignupFn = (payload: CheckoutSignupForm & {
  planId: PaidPlanId;
  interval: CheckoutInterval;
  isBusiness: true;
  termsAccepted: true;
  privacyAccepted: true;
  avvAccepted: true;
}) => Promise<{ url: string }>;

export type LegalConfirmation = {
  isBusiness: true;
  termsAccepted: true;
  privacyAccepted: true;
  avvAccepted: true;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const PAID_PLAN_LABELS: Record<PaidPlanId, string> = {
  nummer: 'Nummer',
  starter: 'Starter',
  pro: 'Pro',
  agency: 'Agency',
};

function defaultSessionStorage(): StorageLike | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function isPaidPlanId(plan: string | null | undefined): plan is PaidPlanId {
  return !!plan && plan !== 'free' && Object.prototype.hasOwnProperty.call(PAID_PLAN_LABELS, plan);
}

export function readPaidPlanPreselection(storage: StorageLike | null = defaultSessionStorage()): {
  plan: PaidPlanId | null;
  interval: CheckoutInterval;
} {
  if (!storage) return { plan: null, interval: 'month' };
  try {
    const plan = storage.getItem('preselectedPlan');
    const rawInterval = storage.getItem('preselectedInterval');
    return {
      plan: isPaidPlanId(plan) ? plan : null,
      interval: rawInterval === 'year' ? 'year' : 'month',
    };
  } catch {
    return { plan: null, interval: 'month' };
  }
}

export function clearPaidPlanPreselection(storage: StorageLike | null = defaultSessionStorage()) {
  if (!storage) return;
  try {
    storage.removeItem('preselectedPlan');
    storage.removeItem('preselectedInterval');
  } catch {
    // Ignore privacy-mode storage errors; checkout already succeeded.
  }
}

export async function startPaidCheckoutSignupAndClearOnSuccess(params: {
  form: CheckoutSignupForm;
  plan: PaidPlanId;
  interval: CheckoutInterval;
  legalConfirmation: LegalConfirmation;
  storage?: StorageLike | null;
  startCheckoutSignup: StartCheckoutSignupFn;
}): Promise<string> {
  const { url } = await params.startCheckoutSignup({
    orgName: params.form.orgName,
    email: params.form.email,
    phone: params.form.phone,
    password: params.form.password,
    planId: params.plan,
    interval: params.interval,
    ...params.legalConfirmation,
  });
  clearPaidPlanPreselection(params.storage ?? defaultSessionStorage());
  return url;
}
