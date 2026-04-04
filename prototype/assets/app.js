const displayElement = document.getElementById('display');
const historyElement = document.getElementById('history');
const keypadElement = document.querySelector('.keypad');

const MAX_DISPLAY_LENGTH = 14;
const OPERATORS = new Set(['+', '-', '*', '/']);

const state = {
  current: '0',
  previous: null,
  operator: null,
  historyText: '',
  overwrite: false,
  justEvaluated: false,
};

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '错误';
  }

  const absolute = Math.abs(value);
  if ((absolute >= 1e12 || (absolute > 0 && absolute < 1e-9))) {
    return value.toExponential(6).replace(/\.?0+e/, 'e');
  }

  const formatted = value
    .toString()
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '');

  return formatted.length > MAX_DISPLAY_LENGTH
    ? Number(value).toPrecision(10).replace(/\.?0+$/, '')
    : formatted;
}

function safeParse(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getOperatorLabel(operator) {
  return {
    '+': '+',
    '-': '−',
    '*': '×',
    '/': '÷',
  }[operator] || operator;
}

function render() {
  displayElement.textContent = state.current;
  historyElement.textContent = state.historyText || (
    state.previous !== null && state.operator
      ? `${formatNumber(state.previous)} ${getOperatorLabel(state.operator)}`
      : ''
  );
}

function resetCalculator() {
  state.current = '0';
  state.previous = null;
  state.operator = null;
  state.historyText = '';
  state.overwrite = false;
  state.justEvaluated = false;
  render();
}

function setError() {
  state.current = '错误';
  state.previous = null;
  state.operator = null;
  state.historyText = '不能除以 0';
  state.overwrite = true;
  state.justEvaluated = false;
  render();
}

function commitDigit(digit) {
  if (state.current === '错误') {
    resetCalculator();
  }

  state.historyText = '';

  if (state.overwrite || state.current === '0') {
    state.current = digit;
    state.overwrite = false;
  } else if (state.current.replace('-', '').length < MAX_DISPLAY_LENGTH) {
    state.current += digit;
  }

  state.justEvaluated = false;
  render();
}

function commitDecimal() {
  if (state.current === '错误') {
    resetCalculator();
  }

  state.historyText = '';

  if (state.overwrite) {
    state.current = '0.';
    state.overwrite = false;
    state.justEvaluated = false;
    render();
    return;
  }

  if (!state.current.includes('.')) {
    state.current += '.';
  }

  state.justEvaluated = false;
  render();
}

function backspace() {
  if (state.overwrite || state.current === '错误' || state.justEvaluated) {
    state.current = '0';
    state.historyText = '';
    state.overwrite = false;
    state.justEvaluated = false;
    render();
    return;
  }

  state.current = state.current.length > 1 ? state.current.slice(0, -1) : '0';
  if (state.current === '-' || state.current === '') {
    state.current = '0';
  }
  render();
}

function evaluate() {
  if (state.operator === null || state.previous === null || state.current === '错误') {
    return;
  }

  const currentValue = safeParse(state.current);
  let nextValue;

  switch (state.operator) {
    case '+':
      nextValue = state.previous + currentValue;
      break;
    case '-':
      nextValue = state.previous - currentValue;
      break;
    case '*':
      nextValue = state.previous * currentValue;
      break;
    case '/':
      if (currentValue === 0) {
        setError();
        return;
      }
      nextValue = state.previous / currentValue;
      break;
    default:
      return;
  }

  state.historyText = `${formatNumber(state.previous)} ${getOperatorLabel(state.operator)} ${formatNumber(currentValue)} =`;
  state.current = formatNumber(nextValue);
  state.previous = null;
  state.operator = null;
  state.overwrite = true;
  state.justEvaluated = true;
  render();
}

function commitOperator(nextOperator) {
  if (state.current === '错误') {
    resetCalculator();
    return;
  }

  const currentValue = safeParse(state.current);
  state.historyText = '';

  if (state.operator && state.previous !== null && !state.overwrite) {
    evaluate();
    if (state.current === '错误') {
      return;
    }
    state.previous = safeParse(state.current);
  } else if (state.previous === null) {
    state.previous = currentValue;
  }

  state.operator = nextOperator;
  state.overwrite = true;
  state.justEvaluated = false;
  render();
}

function convertPercent() {
  if (state.current === '错误') {
    return;
  }

  state.historyText = '';
  state.current = formatNumber(safeParse(state.current) / 100);
  state.overwrite = true;
  state.justEvaluated = false;
  render();
}

function handleAction(action, value) {
  switch (action) {
    case 'digit':
      commitDigit(value);
      break;
    case 'decimal':
      commitDecimal();
      break;
    case 'operator':
      commitOperator(value);
      break;
    case 'equals':
      evaluate();
      break;
    case 'clear':
      resetCalculator();
      break;
    case 'backspace':
      backspace();
      break;
    case 'percent':
      convertPercent();
      break;
    default:
      break;
  }
}

keypadElement.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  handleAction(button.dataset.action, button.dataset.value || '');
});

window.addEventListener('keydown', (event) => {
  const { key } = event;

  if (/^\d$/.test(key)) {
    handleAction('digit', key);
    return;
  }

  if (key === '.') {
    event.preventDefault();
    handleAction('decimal');
    return;
  }

  if (OPERATORS.has(key)) {
    event.preventDefault();
    handleAction('operator', key);
    return;
  }

  if (key === 'Enter' || key === '=') {
    event.preventDefault();
    handleAction('equals');
    return;
  }

  if (key === 'Backspace') {
    event.preventDefault();
    handleAction('backspace');
    return;
  }

  if (key === 'Escape' || key.toLowerCase() === 'c') {
    event.preventDefault();
    handleAction('clear');
    return;
  }

  if (key === '%') {
    event.preventDefault();
    handleAction('percent');
  }
});

render();
