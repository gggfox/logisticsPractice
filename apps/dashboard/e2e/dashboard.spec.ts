import { expect, test } from '@playwright/test'

// Scope locators to the sidebar by `data-testid` to avoid strict-mode
// violations when a page body happens to contain the same copy
// (e.g. "Live" badge vs "Live Feed" nav item, or the "Carrier Sales"
// brand vs the "Carrier sales performance..." subtitle on Overview).
const sidebar = (page: import('@playwright/test').Page) => page.getByTestId('sidebar')
const sidebarLink = (page: import('@playwright/test').Page, id: string) =>
  page.getByTestId(`sidebar-nav-${id}`)

test('dashboard loads with sidebar navigation', async ({ page }) => {
  await page.goto('/')
  await expect(sidebar(page).getByText('Carrier Sales')).toBeVisible()
  await expect(sidebarLink(page, 'overview')).toBeVisible()
  await expect(sidebarLink(page, 'live')).toBeVisible()
  await expect(sidebarLink(page, 'calls')).toBeVisible()
  await expect(sidebarLink(page, 'loads')).toBeVisible()
  await expect(sidebarLink(page, 'carriers')).toBeVisible()
  await expect(sidebarLink(page, 'negotiations')).toBeVisible()
})

test('can navigate to all pages', async ({ page }) => {
  await page.goto('/')

  await sidebarLink(page, 'live').click()
  await expect(page.getByTestId('page-main')).toBeVisible()

  await sidebarLink(page, 'calls').click()
  await expect(page.getByRole('columnheader', { name: 'Outcome' })).toBeVisible()

  await sidebarLink(page, 'loads').click()
  await expect(page.getByText('Search origin')).toBeVisible()

  await sidebarLink(page, 'carriers').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Carrier intelligence' })).toBeVisible()

  await sidebarLink(page, 'negotiations').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Negotiation analytics' })).toBeVisible()
})

// CI runs Playwright against a built bundle with a stub `VITE_CONVEX_URL`,
// so the Overview page's KPI tiles never hydrate (Convex queries can't
// reach a real backend). Skip instead of asserting on unreachable data.
test.skip('overview page shows KPI cards', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Total Calls')).toBeVisible()
  await expect(page.getByText('Booking Rate')).toBeVisible()
  await expect(page.getByText('Revenue Booked')).toBeVisible()
})

test('call history page has filter controls', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Call History').click()
  const outcomeFilter = page.locator('select').first()
  await expect(outcomeFilter).toBeVisible()
})

test('load board page shows search input', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Load Board').click()
  await expect(page.getByRole('searchbox').or(page.locator('input[type="search"]'))).toBeVisible()
})

test('dark mode toggle works', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Dark Mode').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByText('Light Mode').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})
