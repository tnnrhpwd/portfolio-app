import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import PurchaseGateNotice, {
  DEFAULT_GATE_MESSAGE,
  GATE_SUPPORT_PATH,
} from './PurchaseGateNotice.jsx';

const renderNotice = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * The purchase gate is intentional — we don't sell until the product is ready.
 * What must never happen is the gate becoming a *wall*: the surface hides or
 * disables the upgrade control and the visitor is left with no explanation and
 * nobody to ask. These tests pin the way out.
 */
describe('PurchaseGateNotice', () => {
  afterEach(cleanup);

  it('always offers a way to reach a human', () => {
    renderNotice(<PurchaseGateNotice />);

    expect(screen.getByRole('link', { name: /ask us about pro/i }))
      .toHaveAttribute('href', GATE_SUPPORT_PATH);
  });

  it('explains the pause even when the admin sent no copy', () => {
    renderNotice(<PurchaseGateNotice />);

    expect(screen.getByText(DEFAULT_GATE_MESSAGE)).toBeInTheDocument();
  });

  it("shows the admin's message when there is one", () => {
    renderNotice(<PurchaseGateNotice message="We are re-working billing until October." />);

    expect(screen.getByText('We are re-working billing until October.')).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_GATE_MESSAGE)).toBeNull();
    // The escape hatch survives the custom copy — that is the whole point.
    expect(screen.getByRole('link', { name: /ask us about pro/i })).toBeInTheDocument();
  });

  it('announces politely rather than as an error', () => {
    renderNotice(<PurchaseGateNotice />);

    expect(screen.getByRole('status')).toHaveTextContent(DEFAULT_GATE_MESSAGE);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('can drop the link only when the caller already provides a way out', () => {
    renderNotice(<PurchaseGateNotice showSupportLink={false} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(DEFAULT_GATE_MESSAGE)).toBeInTheDocument();
  });
});
