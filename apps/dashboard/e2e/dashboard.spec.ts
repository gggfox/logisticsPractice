import { expect, test } from '@playwright/test'

test('dashboard loads with sidebar navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Carrier Sales')).toBeVisible()
  await expect(page.getByText('Overview')).toBeVisible()
  await expect(page.getByText('Live Feed')).toBeVisible()
  await expect(page.getByText('Call History')).toBeVisible()
  await expect(page.getByText('Load Board')).toBeVisible()
  await expect(page.getByText('Carriers')).toBeVisible()
  await expect(page.getByText('Negotiations')).toBeVisible()
})

test('can navigate to all pages', async ({ page }) => {
  await page.goto('/')

  await page.getByText('Live Feed').click()
  await expect(page.getByText('Live')).toBeVisible()

  await page.getByText('Call History').click()
  await expect(page.getByText('Outcome')).toBeVisible()

  await page.getByText('Load Board').click()
  await expect(page.getByText('Search origin')).toBeVisible()

  await page.getByText('Carriers').click()
  await expect(page.getByText('MC Number')).toBeVisible()

  await page.getByText('Negotiations').click()
  await expect(page.getByText('Total Negotiations')).toBeVisible()
})

test('overview page shows KPI cards', async ({ page }) => {
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
