/**
 * One-time script: creates Stripe Products + Prices for our plans.
 * Run with: npx tsx scripts/setup-stripe.ts
 */
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });

const PLANS = [
  { id: 'nummer', name: 'Nummer', price: 899, description: '70 Min/Mo, 1 Agent, 1 Telefonnummer' },
  { id: 'starter', name: 'Starter', price: 7900, description: '360 Min/Mo, 1 Agent, 1 Telefonnummer' },
  { id: 'pro', name: 'Professional', price: 17900, description: '1.000 Min/Mo, 3 Agents, 3 Telefonnummern' },
  { id: 'agency', name: 'Agency', price: 34900, description: '2.400 Min/Mo, 10 Agents, 10 Telefonnummern' },
];

async function main() {
  console.log('Creating Stripe products and prices...\n');

  for (const plan of PLANS) {
    const product = await stripe.products.create({
      name: `Voice Agent ${plan.name}`,
      description: plan.description,
      metadata: { planId: plan.id },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.price,
      currency: 'eur',
      recurring: { interval: 'month' },
      metadata: { planId: plan.id },
    });

    console.log(`${plan.name}:`);
    console.log(`  Product: ${product.id}`);
    console.log(`  Price:   ${price.id}`);
    console.log();
  }

  console.log('Done! Copy the Price IDs into your .env file:');
  console.log('STRIPE_PRICE_NUMMER=price_...');
  console.log('STRIPE_PRICE_STARTER=price_...');
  console.log('STRIPE_PRICE_PRO=price_...');
  console.log('STRIPE_PRICE_AGENCY=price_...');
}

main().catch(console.error);
