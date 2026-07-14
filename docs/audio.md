# Voice Clips

These clips were generated with the MiniMax `Explorative_Girl` voice on 2026-07-12. They are static site assets served from `/audio/`.

| File | Transcript | Current use |
| --- | --- | --- |
| `welcome-start-tasks.mp3` | 多乐，准备好了吗？我们先学一个汉字，再读两本英语绘本吧。 | No tasks completed |
| `welcome-new-day.mp3` | 新的一天开始啦！多乐，今天会收集到几颗星星呢？ | No tasks completed, alternate |
| `welcome-collect-stars.mp3` | 多乐，你好呀！今天也来收集亮晶晶的小星星吧！ | Some tasks completed |
| `task-chinese-complete-1.mp3` | 多乐，你学会了一个新汉字！认真学习的你，得到一颗小星星！ | Chinese task completed |
| `task-chinese-complete-2.mp3` | 汉字任务完成啦！多乐的星星罐里，又多了一颗闪闪的小星星！ | Chinese task completed, alternate |
| `task-reading-complete-1.mp3` | 多乐认真读完了两本英语绘本，奖励两颗小星星！ | Reading task completed |
| `task-reading-complete-2.mp3` | 英语阅读完成啦！一颗、两颗，两颗星星都飞进星星罐啦！ | Reading task completed, alternate |
| `all-tasks-complete.mp3` | 今天的小目标全部完成！现在可以开心地看看星星罐啦！ | Reserved; repeatable tasks no longer have an all-complete state |
| `not-enough-stars.mp3` | 还差一点点就能兑换礼物啦。没关系，我们慢慢收集。 | Spend rejected for insufficient balance |
| `reward-redeemed-1.mp3` | 心愿兑换成功啦！这是多乐认真完成任务得到的礼物。 | Redemption succeeded |
| `reward-redeemed-2.mp3` | 恭喜多乐！小星星变成喜欢的礼物啦！ | Redemption succeeded, alternate |
| `encourage-try-again.mp3` | 没关系，我们慢慢来。认真试一试，就是很棒的进步！ | Reserved encouragement |
| `encourage-rest.mp3` | 今天不想做也没关系。休息一下，准备好了我们再开始。 | Reserved encouragement |
| `encourage-think-together.mp3` | 遇到不会的地方，不要着急。我们可以一起想办法。 | Reserved encouragement |
| `goodbye-tomorrow.mp3` | 多乐今天辛苦啦！星星小助手明天再和你一起加油！ | Reserved closing |
| `goodbye-playtime.mp3` | 今天的星星收集结束啦。多乐，去开心地玩一会儿吧！ | Reserved closing |

## Playback mapping

- No completed tasks: random `welcome-start-tasks` or `welcome-new-day`.
- Some completed tasks: `welcome-collect-stars`.
- All completed tasks: `all-tasks-complete`.
- Chinese task: random Chinese completion clip, unless it is the final task.
- Reading/English/Oxford task: random reading completion clip, unless it is the final task.
- Successful spending: random redemption clip.
- Insufficient balance: `not-enough-stars`.

Reserved clips are shipped but not automatically triggered yet.
