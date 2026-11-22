# Expedição Aurora

Jogo de tabuleiro multijogador no navegador. O mapa roda em Phaser 3. O servidor Node.js arbitra ações, encontros, transações, pareamentos e batalhas. A campanha usa a exportação do banco local da Pokédex e o motor de combate de Pokémon Showdown por meio do pacote `@pkmn/sim`.

## Jogar

Com Node.js 24 ou posterior, execute estes comandos nesta pasta.

```sh
npm ci
npm start
```

Abra [o lobby local](http://localhost:4173). Para jogar na mesma rede, abra o endereço IP do computador anfitrião na porta 4173 nos outros aparelhos. Todos entram no mesmo servidor e usam o código da sala. Para testar sozinho, abra duas abas independentes e inscreva um treinador em cada uma.

Escolha um personagem disponível no lobby e marque **Estou pronto**. Cada personagem pode ser usado por um único treinador na sala. O anfitrião escolhe a duração da partida, o multiplicador de XP e se haverá minigame. A partida começa com 2, 4, 6, 8, 10 ou 12 treinadores prontos. Recarregar a página na mesma aba reconecta o jogador. O servidor salva as salas neste computador e recupera a partida após uma reinicialização.

## Publicação na Vercel

Nos minigames de reflexo multiplayer, os navegadores negociam o WebRTC pela API e trocam prévias de jogadas diretamente com o navegador anfitrião. A API confirma comandos, colisões e resultados. O modo de treino e as redes onde a conexão direta falha continuam usando HTTP. A configuração atual usa STUN para descobrir rotas diretas.

Importe o repositório na Vercel com a pasta raiz `.`, preset **Other**, Node.js **24.x** e branch de produção `main`. O arquivo `vercel.json` define a região São Paulo (`gru1`), as rotas e o build. Cada push na branch de produção executa os testes antes da publicação.

Conecte um banco Upstash Redis pelo Marketplace da Vercel. Escolha São Paulo para o banco se a região estiver disponível no plano. Habilite as variáveis para Production e faça um novo deploy se o banco tiver sido conectado após a publicação. A API lê `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` ou o par `KV_REST_API_URL` e `KV_REST_API_TOKEN`. Use o token de leitura e escrita. Os snapshots das salas ficam no banco entre deploys. O servidor local continua usando os arquivos de save do computador.

Após o primeiro deploy, abra o domínio em duas abas independentes, crie uma sala, entre com o segundo treinador e marque os dois como prontos. O lobby sozinho só confirma que os arquivos estáticos foram publicados.

## Primeiros passos no jogo

1. Em Porto Aurora, abra o Posto de Trabalho, assuma uma vaga de vendedor ou auxiliar de enfermagem e vá ao local do emprego para trabalhar. O primeiro turno paga ₽ 100.
2. Na loja, compre uma Poké Bola por ₽ 100. Clique em um destino ligado por uma rota a partir da sua posição. Viajar é grátis, e os avatares de todos os jogadores mostram as viagens no mapa.
3. Viaje até um bioma e explore. Antes da primeira captura, você pode lançar bolas ou fugir. Lançar uma bola pode falhar. Com Pokémon aptos na equipe, a exploração inicia uma batalha.
4. Use o centro para recuperar HP, PP e condições de status. Você pode organizar até seis Pokémon na equipe, escolher seu líder e guardar os demais na box.

## Rodadas

A primeira rodada começa com uma carta Tutorial para cada treinador. Todos acompanham a leitura. Cada carta precisa ser confirmada pelo destinatário antes da próxima carta ou do início da expedição. Na abertura de rodadas seguintes, quem viajou seis ou mais trechos na última rodada tem 80% de chance de receber Cansaço e começar com oito ações. Quem passou a rodada sem batalha selvagem, de ginásio ou duelo tem 20% de chance de receber Pokémon preguiçoso se tiver equipe. Um Pokémon da equipe é sorteado, perde dez de felicidade e fica paralisado.

Os treinadores têm dez ações simultâneas. Trabalho, cura, exploração, carinho e desafio de ginásio custam uma ação cada. Curar a equipe também custa ₽ 100. Entrar na loja é grátis. Confirmar o carrinho custa uma ação e pode reunir compras e vendas na mesma transação. Organizar a equipe é livre. Assumir uma vaga custa uma ação. Os comandos internos de uma batalha de exploração ou ginásio fazem parte da ação que iniciou o encontro.

Quando todos encerram as ações, cada jogador vê o resumo dos treinadores e confirma a leitura. Na etapa de trocas, é possível negociar dinheiro, itens e Pokémon. A transação acontece quando o destinatário aceita e os dois lados ainda têm os bens. O minigame opcional paga ₽ 180 por acerto. Em seguida, o servidor sorteia pares para os duelos. As equipes entram recuperadas no nível 50 em cópias temporárias e o vencedor ganha ₽ 250. Um treinador sem equipe perde por ausência contra uma equipe formada. Dois treinadores sem equipe empatam. Ao fim das ações da última rodada, a partida vai direto para a classificação final.

Cada encontro selvagem tem 5% de chance de gerar um shiny. Todas as categorias contam em toda partida. O jogo soma 10 pontos por shiny capturado pelo treinador, 3 por espécie já registrada, 1 ponto por ₽ 200 de saldo final, 10 por insígnia e 40 por completar a Elite Four. Empates na maior pontuação compartilham a vitória.

Carentesco dá 1 ponto por carinho. Duelos entre treinadores dá 5 pontos por vitória, incluindo vitórias por ausência.

Vitórias em minigames rendem 5 pontos cada. Contam o acerto no desafio do Mercado, a vitória no Leilão, cada vencedor da Corrida e o primeiro lugar no Quiz do Milhão com pelo menos um acerto.

## Progressão e conteúdo

As equipes dos oito ginásios crescem de dois para cinco Pokémon, e os níveis vão de 10 a 80. Após as oito insígnias, viaje de Costa Serena ou Monte Azul à Ilha da Liga para enfrentar os quatro desafios da Elite Four, cada um com seis Pokémon de nível-base 90. Cada Pokémon adversário dos ginásios e da Elite Four tem um ajuste individual sorteado de −3 a +2, fixo durante a partida. A sequência da Elite Four custa uma ação. Você pode usar itens da Mochila nos intervalos sem gastar ações adicionais. A premiação da Elite Four só é concedida após as quatro vitórias. Os encontros usam grupos por bioma com restrições de raridade e nível. A captura combina taxa da espécie, HP, condição e bola. Os dois primeiros turnos de cada cargo por rodada dão 100 XP cada. Consulte o [Guia do treinador](http://localhost:4173/guia) para os requisitos de promoção e salários.

A experiência usa as seis curvas do catálogo, com multiplicador configurável. A equipe aprende golpes por nível. Se um Pokémon já conhece quatro golpes, o treinador escolhe qual esquecer ou recusa o novo golpe. O motor de evolução consulta condições de nível, felicidade, gênero, golpe, troca e itens. Rodadas ímpares contam como dia e pares como noite para evoluções por nível. Condições especiais sem evento correspondente na campanha podem impedir algumas evoluções. Segurar uma Mega Pedra compatível habilita a opção de Mega Evolução quando o simulador a oferece. Ao encerrar a fase de ações, cada Pokémon perde 2 pontos de felicidade, inclusive na Box. A carta Pokémon infeliz aparece no início da rodada seguinte para avisar sobre cada Pokémon que terminou a rodada anterior abaixo de 50 e permaneceu com o treinador. O Pokémon só pode fugir depois que o treinador confirmar a leitura da carta Pokémon infeliz e tiver a fase de ações para cuidar dele. Abaixo de 50, a chance de fuga é de 50% mais um ponto percentual para cada ponto de felicidade abaixo de 50. Quando a felicidade volta a pelo menos 50 antes da perda de felicidade do fim da rodada, um novo período de infelicidade exige um novo aviso. Se fugir, o Pokémon sai da equipe ou da Box e a carta Treinador do mal aparece na rodada seguinte.

Os sprites de Pokémon são carregados do Showdown com alternativa estática da PokéAPI. Os ícones de itens da PokéAPI são servidos localmente, com as origens registradas em `data/item-sprites.json`. A cobertura de animações depende dos arquivos disponíveis nessas fontes. O mapa e os dados de campanha estão incluídos no projeto.

## Validação e fontes

Execute `npm test` para verificar progressão, batalhas, economia, turnos e compatibilidade do catálogo. A exportação de `data/rules.json` pode ser refeita com `python scripts/export-rules.py` quando o arquivo `pokedex.sqlite` estiver na pasta superior.

[PokéAPI](https://github.com/PokeAPI/pokeapi) · [Motor de batalhas](https://github.com/pkmn/ps) · [Acervo de sprites](https://github.com/smogon/sprites) · [Phaser](https://phaser.io/)


## Laboratórios

Há laboratórios em Vila das Flores, Vila da Geada e Vila das Cinzas. Uma modificação de IVs, EVs, natureza e/ou habilidade custa ₽ 1.500 e uma ação. O Pokémon perde 100 pontos de felicidade, até o mínimo de zero. Os IVs vão de 0 a 31 e os EVs de 0 a 252 por atributo, com limite total de 510. A cientista oferece as habilidades disponíveis para a espécie e forma, incluindo a oculta quando existe.
