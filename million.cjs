const { randomInt } = require("node:crypto");
const { silhouetteSpecies } = require("./rules.cjs");
const isQuiz = kind => kind === "million" || kind === "pokemonQuiz";

const bank = [
  ["Qual é a capital do Brasil?", "Brasília", "Rio de Janeiro", "São Paulo", "Salvador", "Belo Horizonte"],
  ["Qual planeta é conhecido como Planeta Vermelho?", "Marte", "Vênus", "Mercúrio", "Saturno", "Netuno"],
  ["Quantos lados tem um heptágono?", "Sete", "Cinco", "Seis", "Oito", "Nove"],
  ["Qual é o maior oceano da Terra?", "Pacífico", "Atlântico", "Índico", "Ártico", "Antártico"],
  ["Quem escreveu Dom Casmurro?", "Machado de Assis", "José de Alencar", "Lima Barreto", "Graciliano Ramos", "Jorge Amado"],
  ["Que elemento químico tem o símbolo Fe?", "Ferro", "Flúor", "Fósforo", "Frâncio", "Férmio"],
  ["Em que continente fica o deserto do Saara?", "África", "Ásia", "Europa", "Oceania", "América"],
  ["Qual instrumento mede a pressão atmosférica?", "Barômetro", "Termômetro", "Velocímetro", "Higrômetro", "Cronômetro"],
  ["Em qual esporte se disputa a Copa Davis?", "Tênis", "Golfe", "Vôlei", "Basquete", "Rugby"],
  ["Quem pintou A Noite Estrelada?", "Vincent van Gogh", "Pablo Picasso", "Claude Monet", "Salvador Dalí", "Frida Kahlo"],
  ["Qual é o menor número primo?", "2", "0", "1", "3", "5"],
  ["Qual idioma é oficial na Áustria?", "Alemão", "Francês", "Italiano", "Sueco", "Espanhol"],
  ["Qual destes animais é um mamífero?", "Ornitorrinco", "Pinguim", "Tubarão", "Jacaré", "Polvo"],
  ["Qual é a unidade de corrente elétrica no Sistema Internacional?", "Ampere", "Volt", "Watt", "Ohm", "Joule"],
  ["Em qual país fica a cidade de Quioto?", "Japão", "China", "Tailândia", "Coreia do Sul", "Vietnã"],
  ["Em que ano o Brasil declarou sua independência?", "1822", "1808", "1888", "1889", "1922"],
  ["Quantos anéis há no símbolo olímpico?", "Cinco", "Três", "Quatro", "Seis", "Sete"],
  ["Qual camada da atmosfera abriga a maior parte da camada de ozônio?", "Estratosfera", "Troposfera", "Mesosfera", "Termosfera", "Exosfera"],
  ["Qual destas cidades fica no estado do Pará?", "Belém", "Manaus", "Palmas", "Macapá", "Boa Vista"],
  ["Quem compôs As Quatro Estações?", "Antonio Vivaldi", "Wolfgang Amadeus Mozart", "Johann Sebastian Bach", "Ludwig van Beethoven", "Frédéric Chopin"],
  ["Qual é o maior planeta do Sistema Solar?", "Júpiter", "Saturno", "Urano", "Terra", "Netuno"],
  ["Qual gás é mais abundante na atmosfera terrestre?", "Nitrogênio", "Oxigênio", "Argônio", "Hidrogênio", "Dióxido de carbono"],
  ["Em qual país fica Machu Picchu?", "Peru", "Bolívia", "Equador", "Chile", "Colômbia"],
  ["Qual é o nome do processo em que um líquido passa para o estado sólido?", "Solidificação", "Fusão", "Sublimação", "Condensação", "Vaporização"],
  // Geografia
  ["Qual é a capital da Argentina?", "Buenos Aires", "Córdoba", "Rosário", "Mendoza"],
  ["Qual é a capital do Canadá?", "Ottawa", "Toronto", "Vancouver", "Montreal"],
  ["Qual é a capital da Austrália?", "Camberra", "Sydney", "Melbourne", "Perth"],
  ["Qual é a capital do Uruguai?", "Montevidéu", "Salto", "Punta del Este", "Paysandú"],
  ["Qual é a capital do Chile?", "Santiago", "Valparaíso", "Concepción", "Antofagasta"],
  ["Qual é a capital da Coreia do Sul?", "Seul", "Busan", "Incheon", "Daegu"],
  ["Qual é a capital da Noruega?", "Oslo", "Bergen", "Trondheim", "Stavanger"],
  ["Qual é a capital de Portugal?", "Lisboa", "Porto", "Coimbra", "Braga"],
  ["Qual cidade italiana é famosa pelos canais e pelas gôndolas?", "Veneza", "Florença", "Milão", "Turim"],
  ["Em qual país fica a cidade de Dubrovnik?", "Croácia", "Grécia", "Itália", "Eslovênia"],
  ["Em qual país fica a antiga cidade de Petra?", "Jordânia", "Egito", "Líbano", "Turquia"],
  ["Qual rio atravessa Paris?", "Sena", "Tâmisa", "Tejo", "Danúbio"],
  ["Qual rio atravessa Londres?", "Tâmisa", "Reno", "Sena", "Loire"],
  ["Qual mar banha a costa leste da Itália?", "Adriático", "Báltico", "Vermelho", "Cáspio"],
  ["Em que continente ficam os Andes?", "América do Sul", "Ásia", "Europa", "África"],
  ["Em que continente fica o monte Kilimanjaro?", "África", "Ásia", "Europa", "Oceania"],
  ["Qual país europeu tem território continental em forma semelhante a uma bota?", "Itália", "Espanha", "Grécia", "França"],
  ["Qual destes países não tem acesso ao mar?", "Paraguai", "Uruguai", "Equador", "Chile"],
  ["Em qual estado fica o Parque Nacional dos Lençóis Maranhenses?", "Maranhão", "Piauí", "Ceará", "Bahia"],
  ["Em qual estado fica a cidade de Ouro Preto?", "Minas Gerais", "Goiás", "Espírito Santo", "Rio de Janeiro"],
  ["Qual é a capital de Pernambuco?", "Recife", "Maceió", "Natal", "Aracaju"],
  ["Em qual estado brasileiro fica Foz do Iguaçu?", "Paraná", "Santa Catarina", "Rio Grande do Sul", "Mato Grosso do Sul"],
  // Ciências
  ["Qual órgão bombeia sangue pelo corpo humano?", "Coração", "Fígado", "Pulmão", "Estômago"],
  ["Qual parte do olho regula a quantidade de luz que entra pela pupila?", "Íris", "Retina", "Cristalino", "Nervo óptico"],
  ["Qual é o maior órgão do corpo humano em área?", "Pele", "Fígado", "Pulmão", "Cérebro"],
  ["Que células do sangue transportam a maior parte do oxigênio?", "Hemácias", "Plaquetas", "Linfócitos", "Neutrófilos"],
  ["Qual vitamina o corpo pode produzir na pele com exposição à luz solar?", "Vitamina D", "Vitamina C", "Vitamina B12", "Vitamina B1"],
  ["Qual parte da planta normalmente absorve água e minerais do solo?", "Raiz", "Flor", "Fruto", "Folha"],
  ["Qual pigmento dá a cor verde às folhas?", "Clorofila", "Melanina", "Hemoglobina", "Queratina"],
  ["Qual gás as plantas liberam durante a fotossíntese oxigênica?", "Oxigênio", "Hélio", "Metano", "Nitrogênio"],
  ["Qual é a fórmula química da água?", "H₂O", "CO₂", "O₂", "NaCl"],
  ["Qual é o símbolo químico do ouro?", "Au", "Ag", "Al", "Ar"],
  ["Qual elemento químico tem o símbolo Na?", "Sódio", "Níquel", "Nitrogênio", "Neônio"],
  ["Qual é o número atômico do hidrogênio?", "1", "2", "6", "8"],
  ["Qual escala de temperatura usa zero absoluto como ponto zero?", "Kelvin", "Celsius", "Fahrenheit", "Réaumur"],
  ["Em qual destes meios o som não se propaga?", "Vácuo", "Água", "Aço", "Ar"],
  ["Qual força mantém a Lua em órbita ao redor da Terra?", "Gravidade", "Atrito", "Empuxo", "Capilaridade"],
  ["Qual é a unidade de força no Sistema Internacional?", "Newton", "Pascal", "Joule", "Watt"],
  ["Como se chama a mudança direta do estado sólido para o gasoso?", "Sublimação", "Fusão", "Condensação", "Solidificação"],
  ["Como se chama a mudança do estado gasoso para o líquido?", "Condensação", "Sublimação", "Fusão", "Ebulição"],
  ["Qual instrumento permite observar células em um laboratório?", "Microscópio", "Telescópio", "Periscópio", "Altímetro"],
  ["Qual planeta é o mais próximo do Sol?", "Mercúrio", "Vênus", "Terra", "Marte"],
  ["Qual planeta do Sistema Solar possui os anéis mais proeminentes?", "Saturno", "Terra", "Marte", "Mercúrio"],
  ["Qual é o satélite natural da Terra?", "Lua", "Titã", "Europa", "Fobos"],
  // História
  ["Em que ano caiu o Muro de Berlim?", "1989", "1979", "1991", "1999"],
  ["Em que ano começou a Revolução Francesa?", "1789", "1689", "1815", "1848"],
  ["Em que ano ocorreu o primeiro pouso tripulado na Lua?", "1969", "1957", "1961", "1975"],
  ["Qual missão realizou o primeiro pouso tripulado na Lua?", "Apollo 11", "Apollo 8", "Apollo 13", "Gemini 4"],
  ["Quem foi a primeira pessoa a pisar na Lua?", "Neil Armstrong", "Buzz Aldrin", "Michael Collins", "Yuri Gagarin"],
  ["Qual navegante comandou a expedição portuguesa que chegou ao Brasil em 1500?", "Pedro Álvares Cabral", "Vasco da Gama", "Bartolomeu Dias", "Fernão de Magalhães"],
  ["Quem foi o primeiro imperador do Brasil?", "Dom Pedro I", "Dom Pedro II", "Dom João VI", "Dom Miguel I"],
  ["Em que ano a Lei Áurea foi assinada?", "1888", "1822", "1871", "1889"],
  ["Quem assinou a Lei Áurea?", "Princesa Isabel", "Dom Pedro I", "Deodoro da Fonseca", "Dom João VI"],
  ["Em que ano foi proclamada a República no Brasil?", "1889", "1822", "1888", "1930"],
  ["Quem foi o primeiro presidente do Brasil?", "Deodoro da Fonseca", "Floriano Peixoto", "Prudente de Morais", "Campos Sales"],
  ["Qual era o nome de Tiradentes?", "Joaquim José da Silva Xavier", "José Bonifácio de Andrada e Silva", "Manuel da Silva Ferreira", "Antônio Francisco Lisboa"],
  ["Qual cidade sediou a Semana de Arte Moderna de 1922?", "São Paulo", "Rio de Janeiro", "Recife", "Belo Horizonte"],
  ["Em que ano Brasília foi inaugurada?", "1960", "1955", "1964", "1970"],
  ["Quem era presidente do Brasil na inauguração de Brasília?", "Juscelino Kubitschek", "Getúlio Vargas", "Jânio Quadros", "João Goulart"],
  ["Qual era a capital do Brasil imediatamente antes de Brasília?", "Rio de Janeiro", "Salvador", "São Paulo", "Belo Horizonte"],
  ["Que civilização antiga construiu as pirâmides de Gizé?", "Egípcia", "Romana", "Grega", "Persa"],
  ["Que civilização tinha Tenochtitlán como capital?", "Asteca", "Inca", "Egípcia", "Romana"],
  ["Qual cidade foi soterrada pelo Vesúvio no ano 79 e descoberta sob camadas de cinzas?", "Pompeia", "Esparta", "Cartago", "Atenas"],
  ["Qual documento inglês de 1215 limitou poderes do rei João?", "Magna Carta", "Declaração de Independência", "Edito de Milão", "Código Napoleônico"],
  ["Qual guerra terminou na Europa em 1945?", "Segunda Guerra Mundial", "Primeira Guerra Mundial", "Guerra da Crimeia", "Guerra dos Cem Anos"],
  ["Qual cidade foi a capital do Império Bizantino por grande parte de sua história?", "Constantinopla", "Alexandria", "Veneza", "Atenas"],
  // Literatura e artes
  ["Quem escreveu O Pequeno Príncipe?", "Antoine de Saint-Exupéry", "Júlio Verne", "Victor Hugo", "Alexandre Dumas"],
  ["Quem escreveu Os Lusíadas?", "Luís de Camões", "Fernando Pessoa", "Eça de Queirós", "José Saramago"],
  ["Quem escreveu Romeu e Julieta?", "William Shakespeare", "Charles Dickens", "Oscar Wilde", "Jane Austen"],
  ["Quem escreveu Dom Quixote?", "Miguel de Cervantes", "Federico García Lorca", "Pablo Neruda", "Gabriel García Márquez"],
  ["Quem escreveu O Hobbit?", "J. R. R. Tolkien", "C. S. Lewis", "J. K. Rowling", "Roald Dahl"],
  ["Quem escreveu Frankenstein?", "Mary Shelley", "Emily Brontë", "Virginia Woolf", "Agatha Christie"],
  ["Quem criou o detetive Sherlock Holmes?", "Arthur Conan Doyle", "Edgar Allan Poe", "Ian Fleming", "Bram Stoker"],
  ["Qual escritor brasileiro criou o Sítio do Picapau Amarelo?", "Monteiro Lobato", "Jorge Amado", "Érico Veríssimo", "Carlos Drummond de Andrade"],
  ["Quem escreveu Vidas Secas?", "Graciliano Ramos", "Machado de Assis", "José de Alencar", "Lima Barreto"],
  ["Quem escreveu A Hora da Estrela?", "Clarice Lispector", "Cecília Meireles", "Rachel de Queiroz", "Lygia Fagundes Telles"],
  ["Qual personagem literário tem o nariz que cresce quando mente?", "Pinóquio", "Peter Pan", "Tom Sawyer", "Gulliver"],
  ["Quem pintou a Mona Lisa?", "Leonardo da Vinci", "Michelangelo", "Rafael", "Donatello"],
  ["Quem pintou Guernica?", "Pablo Picasso", "Claude Monet", "Edvard Munch", "Paul Cézanne"],
  ["Quem pintou O Grito?", "Edvard Munch", "Henri Matisse", "Salvador Dalí", "René Magritte"],
  ["Quem pintou Abaporu?", "Tarsila do Amaral", "Anita Malfatti", "Di Cavalcanti", "Candido Portinari"],
  ["Quem pintou o teto da Capela Sistina?", "Michelangelo", "Leonardo da Vinci", "Botticelli", "Caravaggio"],
  ["Qual técnica de gravura usa uma matriz de madeira?", "Xilogravura", "Litografia", "Serigrafia", "Calcografia"],
  ["Que nome recebe uma pintura executada sobre reboco ainda úmido?", "Afresco", "Aquarela", "Colagem", "Mosaico"],
  ["Quem escreveu O Auto da Compadecida?", "Ariano Suassuna", "Nelson Rodrigues", "Jorge Amado", "João Cabral de Melo Neto"],
  ["Quem escreveu A Metamorfose, sobre Gregor Samsa?", "Franz Kafka", "Thomas Mann", "George Orwell", "Ernest Hemingway"],
  ["Quem escreveu Os Sertões?", "Euclides da Cunha", "Aluísio Azevedo", "Lima Barreto", "José de Alencar"],
  ["Qual autor assinou com os heterônimos Álvaro de Campos e Ricardo Reis?", "Fernando Pessoa", "Luís de Camões", "Eça de Queirós", "José Saramago"],
  // Esportes
  ["Quantos jogadores de cada time iniciam em campo no futebol de onze?", "11", "7", "9", "12"],
  ["Quantos jogadores de cada time ficam em quadra no vôlei de praia?", "2", "3", "4", "6"],
  ["Quantos pontos vale um lance livre convertido no basquete?", "1", "2", "3", "4"],
  ["Em qual esporte se usa uma peteca e uma raquete?", "Badminton", "Tênis", "Squash", "Pádel"],
  ["Em qual esporte se disputa Wimbledon?", "Tênis", "Golfe", "Rugby", "Críquete"],
  ["Qual esporte usa os aparelhos trave e barras assimétricas?", "Ginástica artística", "Ginástica rítmica", "Natação artística", "Atletismo"],
  ["Qual destes estilos é usado em uma prova de natação medley?", "Borboleta", "Mergulho livre", "Apneia estática", "Polo aquático"],
  ["Qual é a distância oficial de uma maratona?", "42,195 km", "21,097 km", "40 km", "50 km"],
  ["Em qual esporte se disputa o Tour de France?", "Ciclismo", "Atletismo", "Automobilismo", "Remo"],
  ["Qual modalidade combina esqui de fundo e tiro ao alvo?", "Biatlo", "Triatlo", "Esqui alpino", "Salto de esqui"],
  ["Em qual país surgiu o judô?", "Japão", "China", "Coreia do Sul", "Mongólia"],
  ["Em qual país surgiu o taekwondo?", "Coreia", "Japão", "China", "Tailândia"],
  ["Qual destes esportes usa um bastão para rebater a bola e bases para marcar corridas?", "Beisebol", "Basquete", "Handebol", "Polo aquático"],
  ["Em qual esporte um jogador pode marcar um try?", "Rugby", "Futebol de salão", "Vôlei", "Hóquei no gelo"],
  ["Qual peça do xadrez se move em forma de L?", "Cavalo", "Bispo", "Torre", "Dama"],
  ["No xadrez, qual peça começa ao lado do rei e se move apenas na diagonal?", "Bispo", "Torre", "Cavalo", "Peão"],
  ["Quantas casas tem um tabuleiro de xadrez?", "64", "48", "81", "100"],
  ["Qual país venceu a Copa do Mundo masculina de futebol de 2002?", "Brasil", "Alemanha", "França", "Argentina"],
  ["Qual cidade sediou os Jogos Olímpicos de Verão de 2016?", "Rio de Janeiro", "Londres", "Pequim", "Tóquio"],
  ["Em qual esporte se disputa a Ryder Cup?", "Golfe", "Tênis", "Críquete", "Rugby"],
  ["Em qual esporte se usa um disco chamado puck?", "Hóquei no gelo", "Curling", "Patinação artística", "Esgrima"],
  ["Qual arma da esgrima tem o tronco como alvo principal e usa apenas a ponta para pontuar?", "Florete", "Sabre", "Espada", "Lança"],
  // Música e cultura
  ["Qual instrumento possui teclas, martelos e cordas em seu modelo acústico?", "Piano", "Acordeão", "Órgão de tubos", "Flauta"],
  ["Quantas cordas tem um violão clássico padrão?", "6", "4", "5", "8"],
  ["Qual destes instrumentos é de sopro?", "Clarinete", "Violino", "Harpa", "Tímpano"],
  ["Qual destes instrumentos pertence à família dos metais?", "Trompete", "Oboé", "Fagote", "Clarinete"],
  ["Qual instrumento costuma marcar a pulsação grave numa bateria?", "Bumbo", "Chimbal", "Caixa", "Prato de ataque"],
  ["Quem compôs a Nona Sinfonia com a Ode à Alegria?", "Ludwig van Beethoven", "Antonio Vivaldi", "Frédéric Chopin", "Claude Debussy"],
  ["Quem compôs o balé O Lago dos Cisnes?", "Piotr Tchaikovsky", "Igor Stravinsky", "Maurice Ravel", "Giuseppe Verdi"],
  ["Quem compôs a ópera A Flauta Mágica?", "Wolfgang Amadeus Mozart", "Giacomo Puccini", "Richard Wagner", "Georges Bizet"],
  ["Qual músico brasileiro é conhecido como Rei do Baião?", "Luiz Gonzaga", "Pixinguinha", "Cartola", "Noel Rosa"],
  ["Quem compôs Garota de Ipanema com Vinicius de Moraes?", "Tom Jobim", "Chico Buarque", "Caetano Veloso", "Gilberto Gil"],
  ["Quem interpretou Dorothy em O Mágico de Oz, de 1939?", "Judy Garland", "Audrey Hepburn", "Vivien Leigh", "Julie Andrews"],
  ["Qual grupo lançou a canção Bohemian Rhapsody?", "Queen", "Pink Floyd", "The Beatles", "ABBA"],
  ["Qual banda lançou o álbum Abbey Road?", "The Beatles", "The Rolling Stones", "Queen", "Led Zeppelin"],
  ["Qual dança surgiu na região do Rio da Prata?", "Tango", "Samba", "Flamenco", "Polca"],
  ["A qual estado brasileiro o frevo é tradicionalmente associado?", "Pernambuco", "Paraná", "Goiás", "Rio Grande do Sul"],
  ["Qual ingrediente é a base do guacamole?", "Abacate", "Manga", "Pepino", "Batata"],
  ["Qual grão é usado como base do risoto tradicional?", "Arroz", "Trigo", "Milho", "Cevada"],
  ["Qual ingrediente dá origem ao tofu?", "Soja", "Grão-de-bico", "Lentilha", "Feijão-preto"],
  ["Qual prato japonês costuma combinar arroz temperado com vinagre e outros ingredientes?", "Sushi", "Tempurá", "Yakitori", "Missoshiru"],
  ["Qual país é tradicionalmente associado ao nascimento da pizza napolitana?", "Itália", "Grécia", "Espanha", "França"],
  ["Qual fruto fornece as sementes usadas para fazer chocolate?", "Cacau", "Café", "Açaí", "Cupuaçu"],
  ["Qual bebida tradicional argentina e uruguaia é feita com erva-mate em uma cuia?", "Mate", "Chicha", "Horchata", "Sidra"],
  // Animais e natureza
  ["Qual é o maior animal vivo da Terra em massa?", "Baleia-azul", "Elefante-africano", "Tubarão-baleia", "Orca"],
  ["Qual é o maior animal terrestre vivo em massa?", "Elefante-africano-da-savana", "Girafa", "Hipopótamo", "Rinoceronte-branco"],
  ["Qual destes animais é um marsupial?", "Coala", "Panda-gigante", "Lontra", "Capivara"],
  ["Qual destes animais é um réptil?", "Iguana", "Salamandra", "Rã", "Sapo"],
  ["Qual destes animais é um anfíbio?", "Salamandra", "Lagartixa", "Crocodilo", "Jabuti"],
  ["Qual destes animais pertence à classe dos aracnídeos?", "Escorpião", "Formiga", "Besouro", "Camarão"],
  ["Quantas patas tem um inseto adulto típico?", "6", "4", "8", "10"],
  ["Quantos braços tem um polvo típico?", "8", "4", "6", "10"],
  ["Qual destes animais é um peixe ósseo?", "Cavalo-marinho", "Golfinho", "Foca", "Tubarão"],
  ["Qual destes animais é uma ave incapaz de voar?", "Avestruz", "Andorinha", "Beija-flor", "Tucano"],
  ["Qual ave usa seu bico forte para perfurar troncos?", "Pica-pau", "Beija-flor", "Pato", "Flamingo"],
  ["Qual animal é conhecido por sua cauda em leque com manchas parecidas com olhos?", "Pavão", "Galo", "Ema", "Pelicano"],
  ["Qual animal produz seda para formar o casulo usado na sericicultura?", "Bicho-da-seda", "Abelha", "Louva-a-deus", "Libélula"],
  ["Qual é o principal alimento do panda-gigante na natureza?", "Bambu", "Eucalipto", "Acácia", "Capim-marinho"],
  ["Qual destes animais usa ecolocalização para se orientar debaixo d’água?", "Golfinho-nariz-de-garrafa", "Tartaruga-verde", "Cavalo-marinho", "Peixe-palhaço"],
  ["Qual animal da América do Sul é o maior roedor vivo?", "Capivara", "Cutia", "Paca", "Castor"],
  ["Qual destes mamíferos é adaptado ao voo ativo?", "Morcego", "Esquilo-voador", "Colugo", "Petauro-do-açúcar"],
  ["Qual destes animais constrói barragens com galhos?", "Castor", "Lontra", "Capivara", "Marmota"],
  ["Qual é o nome da fase larval de um sapo?", "Girino", "Ninfa", "Pupa", "Lagarta"],
  ["Qual bioma brasileiro é caracterizado por vegetação adaptada à seca no semiárido?", "Caatinga", "Pampa", "Pantanal", "Mata Atlântica"],
  ["Que tipo de árvore produz bolotas?", "Carvalho", "Salgueiro", "Pinheiro", "Eucalipto"],
  ["Qual planta produz a fibra usada para fazer tecidos de algodão?", "Algodoeiro", "Linheiro", "Sisal", "Bambu"],
  // Matemática, linguagem e tecnologia
  ["Qual número o algarismo romano L representa?", "50", "10", "100", "500"],
  ["Qual número o algarismo romano IX representa?", "9", "4", "11", "19"],
  ["Quanto é a soma dos ângulos internos de um triângulo plano?", "180°", "90°", "270°", "360°"],
  ["Quantas faces tem um cubo?", "6", "4", "8", "12"],
  ["Quantas arestas tem um cubo?", "12", "6", "8", "16"],
  ["Que nome recebe um triângulo com três lados iguais?", "Equilátero", "Escaleno", "Retângulo", "Obtusângulo"],
  ["Qual é a raiz quadrada de 144?", "12", "10", "14", "16"],
  ["Quanto é 25% de 80?", "20", "10", "25", "40"],
  ["Qual destas frações equivale a 0,75?", "3/4", "1/4", "1/3", "2/3"],
  ["Quantos segundos há em três minutos?", "180", "90", "120", "240"],
  ["Quantos anos há em três décadas?", "30", "3", "60", "300"],
  ["Qual sinal de pontuação costuma encerrar uma pergunta direta?", "Ponto de interrogação", "Ponto de exclamação", "Dois-pontos", "Ponto e vírgula"],
  ["Qual destas palavras é um verbo no infinitivo?", "Correr", "Corrida", "Corredor", "Corrente"],
  ["Qual palavra é antônimo de escasso?", "Abundante", "Raro", "Limitado", "Pouco"],
  ["Qual destes plurais está correto na norma-padrão?", "Cidadãos", "Cidadões", "Cidadães", "Cidadãoses"],
  ["Qual idioma usa o alfabeto grego para sua escrita padrão?", "Grego", "Russo", "Árabe", "Hebraico"],
  ["Qual destes dispositivos converte voz em sinal de áudio?", "Microfone", "Monitor", "Impressora", "Projetor"],
  ["Qual sigla designa a unidade central de processamento de um computador?", "CPU", "USB", "HDMI", "PDF"],
  ["Qual formato é usado principalmente para arquivos de áudio?", "MP3", "PNG", "CSV", "SVG"],
  ["Qual destes formatos é usado para imagens raster?", "PNG", "MP3", "TXT", "WAV"],
  ["Quais são os dois dígitos usados no sistema binário?", "0 e 1", "1 e 2", "0 e 9", "2 e 8"],
  ["Qual protocolo é indicado pelo prefixo https:// em um endereço web?", "HTTPS", "FTP", "SMTP", "Bluetooth"],
];

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pokemonQuestions() {
  const species = shuffle(silhouetteSpecies());
  const distractorsPerQuestion = 23;
  return species.slice(0, 5).map(({name, ...sprite}, index) => {
    const start = 5 + index * distractorsPerQuestion;
    const distractors = species.slice(start, start + distractorsPerQuestion);
    const choices = shuffle([name, ...distractors.map(p => p.name)]);
    const silhouette = {
      ...sprite,
      angle: randomInt(15, 346),
      flipX: randomInt(2) ? -1 : 1,
      flipY: randomInt(2) ? -1 : 1,
      spots: Array.from({length: 4}, (_, i) => {
        const angle = (i * 90 + randomInt(-30, 31)) * Math.PI / 180;
        const radius = randomInt(23, 37);
        return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, size: randomInt(12, 24) };
      }),
    };
    return { prompt: "Quem é esse Pokémon?", choices, answer: choices.indexOf(name), silhouette };
  });
}

function newMillion(players, kind = "million") {
  return {
    questions: kind === "pokemonQuiz" ? pokemonQuestions() : shuffle(bank).slice(0, 5).map(([prompt, correct, ...wrong]) => {
      const choices = shuffle([correct, ...shuffle(wrong).slice(0, 3)]);
      return { prompt, choices, answer: choices.indexOf(correct) };
    }),
    entries: Object.fromEntries(players.map(p => [p.id, { answers: [], score: 0 }])),
    deadline: null,
    results: null,
  };
}

function millionOptions(question) {
  const indexes = question.choices.map((_, index) => index);
  if (!question.silhouette && indexes.length > 4)
    indexes.splice(indexes.findLastIndex(index => index !== question.answer), 1);
  return indexes;
}

function recordAnswer(quiz, entry, choice, now) {
  const question = quiz.questions[entry.answers.length];
  entry.answers.push(choice);
  entry.score += Number(choice === question.answer);
  if (entry.answers.length === quiz.questions.length) entry.finishedAt = now;
}

function advanceMillion(room, now = Date.now()) {
  if (room.phase !== "minigame" || !isQuiz(room.minigame)) return false;
  const quiz = room.million;
  if (!quiz.deadline || quiz.results) return false;
  const entries = Object.values(quiz.entries);
  if (now < quiz.deadline && entries.some(entry => entry.finishedAt == null)) return false;

  const ranked = room.players.map(p => ({ id: p.id, ...quiz.entries[p.id] })).sort((a, b) =>
    b.score - a.score || (a.finishedAt ?? quiz.deadline) - (b.finishedAt ?? quiz.deadline));
  const prizes = ranked.length === 2 ? [650, 350] : [500, 300, 200];
  quiz.results = ranked.map(({id, score}, index) => ({
    id, score, prize: prizes[index] ?? 0,
  }));
  for (const p of room.players) p.money += quiz.results.find(result => result.id === p.id).prize;
  const first = quiz.results[0];
  if (first?.score > 0) {
    const winner = room.players.find(p => p.id === first.id);
    winner.minigameWins = (winner.minigameWins ?? 0) + 1;
  }
  return true;
}

function millionView(quiz, player) {
  const entry = quiz.entries[player.id];
  const index = entry.answers.length;
  const question = quiz.deadline && !quiz.results && quiz.questions[index];
  return {
    deadline: quiz.deadline,
    total: quiz.questions.length,
    index,
    question: question ? {
      prompt: question.prompt, choices: millionOptions(question).map(i => question.choices[i]),
      silhouette: question.silhouette,
    } : null,
    results: quiz.results?.map(result => ({
      ...result,
      checks: quiz.questions.map((q, i) => quiz.entries[result.id].answers[i] === q.answer),
    })) ?? null,
    review: quiz.results ? quiz.questions.map((q, i) => ({
      prompt: q.prompt, correct: q.choices[q.answer], selected: q.choices[entry.answers[i]] ?? null,
      silhouette: q.silhouette,
    })) : null,
  };
}

module.exports = { isQuiz, newMillion, millionOptions, recordAnswer, advanceMillion, millionView };
