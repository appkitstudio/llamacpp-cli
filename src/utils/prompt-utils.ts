import * as readline from 'readline';

/**
 * Prompt user for input
 */
export function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const promptText = defaultValue
      ? `${question} [${defaultValue}]: `
      : `${question}: `;

    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Prompt user for yes/no confirmation
 */
export function confirm(question: string, defaultYes = true): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const suffix = defaultYes ? '[Y/n]' : '[y/N]';

  return new Promise((resolve) => {
    rl.question(`${question} ${suffix}: `, (answer) => {
      rl.close();
      const input = answer.trim().toLowerCase();

      if (input === '') {
        resolve(defaultYes);
      } else {
        resolve(input === 'y' || input === 'yes');
      }
    });
  });
}
