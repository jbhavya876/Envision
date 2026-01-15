/**
 * @file HistoryTable Component
 * @description Displays the last 15 bets in a table format.
 * Shows nonce, roll result, bet amount, and profit/loss.
 * 
 * @component
 * @param {Object} props
 * @param {Array<Object>} props.history - Array of bet history objects
 */

import React from 'react';

const HistoryTable = ({ history }) => {
    return (
        <div className="history-container">
            <table>
                <thead>
                    <tr>
                        <th>Nonce</th>
                        <th>Result</th>
                        <th>Bet</th>
                        <th>Profit</th>
                    </tr>
                </thead>
                <tbody>
                    {history.map((bet, index) => {
                        const profitClass = bet.isWin ? 'col-green' : 'col-red';
                        const profitSign = bet.isWin ? '+' : '';

                        return (
                            <tr key={index}>
                                <td className="col-mute">{bet.nonce}</td>
                                <td className={profitClass}>{bet.roll.toFixed(2)}</td>
                                <td className="col-mute">${bet.betAmount.toFixed(2)}</td>
                                <td className={profitClass}>
                                    {profitSign}{bet.profit.toFixed(2)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export default HistoryTable;
