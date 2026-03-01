from lxmfy import Command


class BasicCommands:
    def __init__(self, bot):
        self.bot = bot

    @Command(name="hello", description="Says hello")
    async def hello(self, ctx):
        ctx.reply(f"Hello {ctx.sender}!")

    @Command(name="about", description="About this bot")
    async def about(self, ctx):
        ctx.reply("I'm Destination Bot, built with LXMFy for the Reticulum Network!")

    @Command(name="page", description="Get Destination Nomad Network page info")
    async def page(self, ctx):
        ctx.reply(
            "Welcome to Destination Pi! This page is served from my Raspberry Pi over the Reticulum mesh. "
            "Visit my node in Nomad Network to browse the full page."
        )


def setup(bot):
    bot.add_cog(BasicCommands(bot))
