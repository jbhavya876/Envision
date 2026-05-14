import React from "react";

function HistoryTable({ history }) {
  return (
    <div className="history-table">
      <h3>Bet History</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Roll</th>
            <th>Bet</th>
            <th>Profit</th>
          </tr>
        </thead>
        <tbody>
          {history.map((bet, idx) => (
            <tr key={idx} className={bet.isWin ? "win" : "loss"}>
              <td>{bet.nonce}</td>
              <td>{bet.roll.toFixed(2)}</td>
              <td>{bet.betAmount.toFixed(2)}</td>
              <td>{(bet.profit / 100).toFixed(2)}</td>  {/* cents → dollars */}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default HistoryTable;