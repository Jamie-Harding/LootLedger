import { render, screen } from '@testing-library/react'

function Hello() {
  return <h1>Hello, Loot Ledger</h1>
}

test('renders greeting', () => {
  render(<Hello />)
  expect(screen.getByText('Hello, Loot Ledger')).toBeInTheDocument()
})
