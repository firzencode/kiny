import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Credit, KINY_SITE_URL } from './Credit'

describe('Credit', () => {
  it('渲染指向 Kiny 站点的外链', () => {
    render(<Credit />)
    const link = screen.getByRole('link', { name: /Made with Kiny/ })
    expect(link).toHaveAttribute('href', KINY_SITE_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})
