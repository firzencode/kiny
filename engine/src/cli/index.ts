import { makeTerminal } from './term'
import { run } from './run'

const term = makeTerminal()
run(process.argv.slice(2), term)
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e)
    process.exit(2) // 2 = 意外崩溃，区别于 run 返回的 1（故事/项目错误）
  })
