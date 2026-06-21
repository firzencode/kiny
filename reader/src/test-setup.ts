import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Mock scrollIntoView in jsdom
Element.prototype.scrollIntoView = vi.fn()
