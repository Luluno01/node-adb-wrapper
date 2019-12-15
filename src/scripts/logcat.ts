import { LogcatProcess, LogcatParser, priorityToString } from '../Logcat'
import * as yargs from 'yargs'
import { Readable } from 'stream'
import { createReadStream } from 'fs'


function usage() {
  console.log(`Usage:
  node build/scripts/logcat.js [--serial serial]
Or:
  node build/scripts/logcat.js <logfile.bin>`)
}

async function main() {
  const argv = yargs
    .option('serial', {
      alias: 's',
      type: 'string',
      description: 'Device serial number',
      demandOption: false
    }).argv
  const file = argv._[0]
  let input: Readable
  let proc: LogcatProcess
  if(file) {
    input = createReadStream(file)
    if(argv.serial) {
      usage()
      process.exit(1)
    }
  } else {
    proc = new LogcatProcess
    proc.start(argv.serial)
    input = proc.output
  }
  const parser = new LogcatParser(input)
  for await(const { time, pid, tid, priority, tag, msg } of parser.asIterator()) {
    console.log(`[${time.toLocaleString()}]\t${pid}-${tid} [${priorityToString(priority)}] ${tag}: ${msg}`)
  }
}

main()
