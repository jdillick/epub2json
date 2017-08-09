#!/usr/bin/env node

const commander = require('commander');
const chalk = require('chalk');
const log = console.log.bind(console);
const error = console.error.bind(console);
const ora = require('ora');
const globby = require('globby');
const fs = require('fs');
const path = require('path');
const EPub = require('epub');
const pkg = require('./package.json');

const help = () => {
  log(chalk.green('  Examples:'));
  log(chalk.yellow('    $ epub2json convert -i </path/to/epubs> -o </path/to/output>\n'));
};

/**
 * Promise of the text content of an epub file
 * @param  {string} ePubPath full path to epub file
 * @return {Promise} string text of epub file
 */
const parseEpub = ePubPath => {
  return new Promise((resolve, reject) => {
    const epub = new EPub(ePubPath);
    let textPromises = [];
    let book = {
      filename: path.basename(ePubPath),
      creator: '',
      title: '',
      language: '',
      subject: '',
      date: '',
      description: '',
      chapterIds: [],
      chapters: {}
    };

    epub.on('end', () => {
      book.creator = epub.metadata.creator;
      book.title = epub.metadata.title;
      book.language = epub.metadata.language;
      book.subject = epub.metadata.subject;
      book.date = epub.metadata.date;
      book.description = epub.metadata.description;

      epub.flow.forEach(chapter => {
        textPromises.push(new Promise((resolve, reject) => {
          epub.getChapter(chapter.id, (error, text) => {
            if (error) {
              reject(error);
            } else {
              resolve({
                id: chapter.id,
                text,
              });
            }
          });
        }));
      });

      Promise.all(textPromises).then(chapters => {
        resolve(chapters.reduce((book, chapter) => {
          book.chapterIds.push(chapter.id);
          book.chapters[chapter.id] = chapter.text;
          return book;
        }, book));
      }).catch(err => {
        reject(err);
      });
    });

    epub.parse();
  });
};

const validInput = inputPath => {
  return validPath(inputPath);
};

const validOutput = outputPath => {
  return validPath(outputPath, fs.W_OK);
};

/**
 * Validate path is directory and has specified access permission
 * @param  {string} path directory path
 * @param  {mode} [flags=fs.R_OK |fs.X_OK] bitwise file mode
 * @return {bool} true if valid
 */
const validPath = (testPath, mode = fs.R_OK | fs.X_OK) => {
  let ok = fs.existsSync(testPath);
  if (ok) {
    const lstat = fs.lstatSync(testPath);
    ok = lstat.isDirectory();
  }

  if (ok) {
    try {
      fs.accessSync(testPath, mode);
    } catch(e) {
      ok = false;
    }
  }

  return ok;
};

const writeJSON = (book, outputPath) => {
  const outputFile = path.normalize(outputPath) + '/' + path.parse(book.filename).name + '.json';
  fs.writeFile(outputFile, JSON.stringify(book), err => {
    log(`Output ${outputFile}`);
    if (err) {
      error(chalk.red(`Unable to write to file ${outputFile}`));
    }
  });
};

/**
 * Convert path of epubs to txt files.
 * @param  {object} commander object
 */
const convertAction = cmd => {
  const inputPath = cmd.inputPath || '';
  const outputPath = cmd.outputPath || '';

  if ( ! inputPath ) {
    error(chalk.red('Missing input path'));
    help();
    process.exit(1);
  }

  if ( ! outputPath ) {
    error(chalk.red('Missing output path'));
    help();
    process.exit(1);
  }

  if ( ! validInput(inputPath) ) {
    error(chalk.red(`No such input path or can not read from '${inputPath}'`));
    process.exit(1);
  }
  if ( ! validOutput(outputPath ) ) {
    error(chalk.red(`No such output path or can not write to '${outputPath}'`));
    process.exit(1);
  }

  let spinner = ora('Loading documents.').start();

  function bookPromises(paths) {
    let promises = [];

    paths.forEach(path => {
      let bookPromise = parseEpub(path);
      promises.push(bookPromise);
      bookPromise.then(book => {
        writeJSON(book, outputPath);
      }).catch(err => {
        log(err);
      });
    });

    return Promise.all(promises);
  };

  globby(`${inputPath}/*.epub`).then(async (paths) => {
    const chunkSize = 10;
    const chunks = Math.ceil(paths.length / chunkSize);
    for (let chunk = 0; chunk < chunks; chunk++ ) {
      let allBooks = [];
      let index = chunk * chunkSize;
      let books = await bookPromises(paths.slice(index, index + chunkSize));
      spinner.text = `chunk ${chunk}`;
    }

    spinner.stop();
  });
};

commander
  .version(pkg.version);

commander
  .command('convert')
  .description('Convert epub files to text files.')
  .option('-i, --input-path <inputPath>', 'the path to the epub files')
  .option('-o, --output-path <outputPath>', 'the path to output the json files')
  .on('--help', help)
  .action(convertAction);

commander.parse(process.argv);

// output the help if nothing is passed
if (!process.argv.slice(2).length) {
  commander.help();
}
