// Listas próprias da frase de ligação: palavras comuns, só letras de a a z (sem acento, para digitar em qualquer
// teclado), sem repetição. O teste confere o tamanho, as letras e a repetição.

const pt = `
abelha abismo abrigo acervo adega afeto agosto agulha alameda alegria alface alfinete alicate alma ameixa amigo
amora amparo andar anel anjo antena anzol apito aquarela aranha arame arbusto areia argila arroz arte asa aspargo
assobio astro atalho atum aula aurora avenida aveia avental azeite azul azulejo bacia bagagem bailarina balde baleia
balsa bambu banana banco bandeira banheira barco barril barro batata batom baunilha beco beijo beira beleza bengala
besouro bezerro biblioteca bicho bicicleta bigode bilhete biscoito bisnaga boca bochecha bola bolo bolsa bombom
boneca bonito borboleta borracha bosque bota branco brasa brejo brilho brinco brisa broto bruma bule buraco buzina
cabana cabelo cabide cabra caderno caixa caju caldo calma cama camelo caminho camisa campo canela caneca caneta
canoa cantiga capim capivara capuz caqui carambola caravela carinho carneiro carta casa casca castanha castelo
cavalo caverna cebola cedro cegonha cenoura cereja cesta cetim chave chinelo chocolate chuva chuveiro cidade cimento
cinema cinto cinza circo cisne clareira clima cobra cobre coelho cofre coisa cola colher colina coluna cometa concha
copo coqueiro coral corda coruja costela couro cravo creme cristal cupim curva dado dama damasco dedal dedo degrau
delta dente desenho destino diamante disco doce dois domingo dourado duna dupla eclipse eixo elefante elevador elo
embalagem enxada enxame escada escola escova escudo esfera espelho espiga esponja esquilo estrada estrela etapa fada
farinha farol fatia fava favo feira feltro feno ferro festa figo fila filme fio fita flauta flor floresta fogo
fogueira folha fonte forno fruta funil gaiola gaivota galho galinha galo garfo garrafa gato gaveta gelo gema girafa
girassol giz golfinho goiaba gola gota grama granito gravata grilo gruta guarda guizo harpa hino horta hotel iate
igreja ilha imagem incenso inverno iogurte jabuti janela jangada jardim jarra jasmim javali jiboia joaninha joelho
jogo jornal juba julho junho lagarta lago lagoa lama lancha lanterna laranja lareira lata legume leite lema lenha
lente leque letra lima linha lixa lobo loja lontra lousa lua lume luva macaco madeira magia maio mala malha mamute
manga manta mapa mar marfim margem mariposa marreco martelo massa mastro mato medalha mel melancia menta mesa milho
mina mirante mochila moeda moinho moita mola montanha morango mosaico mostarda motor mula muralha musgo nabo navio
neblina nevoeiro neve ninho noite noz nuvem oceano oficina olaria oliva onda ontem orvalho osso ostra outono ouro
ovelha ovo paca padaria palco palha palito palmeira panela pano pantufa papel papagaio parede parque pasta pato
pedra peixe pena peneira pepino pera perfume piano pimenta pincel pinha pinheiro pipa pipoca pirata pires piscina
planeta planta pluma pneu poeira polvo pomar ponte porta poste pote potro praia prato prego presente primavera pudim
pulga pulseira quadro queijo quintal rabanete raio raiz ramo raposa rato rede regador remo rena renda retrato rio
rocha roda rolha romance rosa roseira roupa rua rubi sacola safira sagu sal salada salgueiro seda selo semente serra
sereia sino sobrado sol sombra sopa sorvete talher tambor tamanco tampa tapete tatu teatro teia telhado tempero
tenda terra tesoura tigela tijolo tinta toalha tomate topo torre trator trem trevo trigo trilha tronco trono trufa
tucano tulipa turbante uva urso vaca vagalume vale vapor varal vaso vela veleiro veludo vento verde vidro vila vinho
viola violeta xadrez xale xarope zebra zinco alegre amplo antigo atento bravo breve calmo claro curto denso duro
escuro esperto firme fino forte frio fresco gentil grande grosso imenso jovem largo leve limpo lindo liso longo
macio magro manso morno novo nobre pequeno pesado quente raro rico roxo rubro sereno simples suave sutil tenro terno
tranquilo vivo vermelho amarelo preto prateado abrir achar beber brincar cantar comer correr cozinhar desenhar
dormir escrever falar girar jogar ler levar limpar montar nadar olhar ouvir pintar plantar pular regar remar rir
saltar sonhar subir tocar trazer viajar voar vestir abajur adesivo aldeia alicerce almofada alvo amuleto arco
armadura arquivo artista assento atleta autor bairro banquete barraca batuque bazar berimbau bloco bolacha bombeiro
borda bracelete broche cacau cacto cadeado cadeira canal canteiro capacete caramujo cartaz carteira cascata cavaco
chafariz chaleira charrete chocalho ciranda clarinete cobertor cocada colmeia comboio compasso corneta coroa cortina
cotovelo cozinha desfile engenho envelope escultura espantalho estante estojo estufa fazenda fivela formiga
framboesa freixo gangorra garagem gargalo gengibre geleia gibi gincana globo gramado guitarra iglu jaqueta jarro
jogral labirinto ladrilho lagosta lamparina lapela lasanha lava lavanda legado livro losango lustre maestro mandioca
manteiga maquete maracatu marujo matilha medusa melodia mercado mexerica miolo mirtilo modelo moldura monge mosquito
mural museu novelo orquestra palmito panqueca parafuso patins pedal pelicano penhasco pergaminho periquito pesca
pilar pinguim pista planalto plateia poema ponteiro portal pradaria prancha quiabo quimono rapadura rebanho recado
recreio remanso retalho riacho robalo rodovia rouxinol sabugo saleiro samambaia sanfona sardinha saveiro seringueira
silhueta sinfonia sobremesa sorriso tabuleiro tainha tamarindo tangerina tapioca tartaruga tempestade tesouro timbre
tirolesa tocha tomilho torrada travesseiro trombone trompete tropa umbu urtiga usina vassoura vereda vinhedo violino
vitral xaxim zabumba abacate abacaxi acerola agenda agito ajuda alavanca alcateia algema alho alvorada amendoim
ancinho andorinha anta apetite apoio arena arraia arrecife assado aveludado azevinho bacalhau badejo bainha baixela
bala banda bandolim baralho barbante barqueiro bateria baterista beliche bergamota berro bico bilro bingo biombo
bocejo bodega bolero boliche bonde boreal bornal braseiro bravura brigadeiro brotinho burburinho cabaninha cacimba
calango camomila cancela candeeiro canjica cantina capela capoeira caracol carimbo carrossel carvalho casaco caseiro
catavento cativo cavalete cebolinha cedilha cerca cerrado chapada charco cipreste clave cocar coentro coletivo
colete comadre combate cometer concerto contador copa coragem cordel corredor cortejo costura coxilha cratera crepe
crina cuia cumbuca cume cunhado cuscuz dentista deserto despertar dezena diadema dobradura dorso doutor duende
embaixo emblema empada encanto enfeite engenheiro enigma enseada entrada escaler escarlate escoteiro esmalte
espinafre esquina estrondo farofa farelo fartura faxina fenda ferradura ferrugem figura filhote fisgada floco
fogareiro folguedo forquilha fortaleza frevo frigideira fuga gafanhoto galeria galope garoa gazela gelatina gemada
genro gigante ginga gingado girino gorro graveto grelha grinalda guache guarita guerreiro gurizada harmonia herdeiro
horizonte ilhota impulso inhame inseto jabuticaba jaguar jambo janta jararaca jerimum jornada lampejo laranjeira
latido lavoura leiteiro lembrete leopardo levante ligeiro limoeiro lindeza listra lombada luar lutador madrugada
maduro malabares mamona mandacaru maresia marinho mascote matagal matinal mergulho meteoro mimo minhoca miragem
mirim mocambo moleque morada mugido namoro narciso navegante negrito ninar noturno obra oleiro oriente paineira
pamonha pandeiro parceiro pardal parreira passarela pastel patinete pedreiro peteca petisco pirilampo pitanga pomada
pororoca prumo quadrilha quaresma quentinho quindim quitanda rabisco rainha ramalhete rapina rasteira recanto
refresco repente ribeira rodamoinho romeiro sacada sagui salmoura salto sambista sapeca saracura saudade serenata
seresta serpente sertanejo sibipiruna sobrinho sossego sotaque tacho tamboril tambaqui tanajura tarefa tarrafa
tatuzinho tecido teimoso tico tinteiro tiziu toada tombo tora toucinho travessa trinca trovador trovoada tutano
urucum vaqueiro varanda veranico vigia vinheta violeiro viveiro
`;

const en = `
able acid acorn actor adapt admit adult agent agree ahead aisle alarm album alert alien alley allow alpha amber
ample angle ankle apple april apron arena argue arrow aside asset atlas attic audio audit avoid awake award badge
bagel baker balance bamboo banana banjo barely barrel basic basin basket batch beach beacon beard beauty beaver
became bench berry bicycle birch biscuit bishop blade blank blanket blast blaze blend bless blind block bloom blouse
board boat bonus booth border bottle bounce bowl brain brake branch brave bread breeze brick bridge brief bright
brisk broom brush bubble bucket buddy budget buffalo bugle build bundle bunker burger butter button cabin cable
cactus cake camel camera camp canal candle candy canoe canvas canyon capable captain carbon cargo carpet carrot
carton cashew castle casual catalog cattle cause cedar celery cellar census cereal chair chalk champion change
chapter charm chase cheese cherry chess chest chicken chief child chimney choice chorus cider cinema circle circus
citrus city civic claim clap clarify claw clay clean clerk clever click client cliff climb clinic clock cloth cloud
clover clown club coach coast coconut coffee coin collar color column comet comfort comic common copper coral corner
cotton couch country couple course cousin cover coyote crab cradle craft crane crater crayon cream credit creek crew
cricket crisp crop cross crowd crown cruise crumb crystal cube culture cupboard curious current curtain curve
cushion custom cycle dairy daisy damp dance dawn deal debate decade decent deer degree delta denim dentist depth
desert design desk detail device diamond diary diesel dinner direct dish divide doctor dolphin domain donkey door
dose double dove dozen draft dragon drama drawer dream dress drift drill drink drum duck dune dust eager eagle early
earth easel east easy echo eclipse edge eight elbow elder elegant element elephant elite elm embark ember emerald
empire empty endless energy engine enjoy enough entire entry envelope episode equal escape essay estate evening
exact exhibit exit exotic expand fabric face factor fade faint fair falcon family famous fancy farm fashion fatal
father fault feast feather fence ferry festival fiber fiction field figure filter final finger fire firm fiscal flag
flame flash flavor fleet flight float flock floor flower fluid flute focus foggy folder forest fork fortune forum
fossil fountain fox frame fresh fridge friend frog frost fruit fuel funny furnace gadget galaxy gallery garage
garden garlic gate gather gauge gazelle gecko gentle genuine ghost giant ginger giraffe glacier glad glass globe
glove glow goat golden goose gorilla gospel gossip govern grace grain grape grass gravity great green grid grief
grit grocery group grow guard guess guide guitar habit hamster hand happy harbor harvest hawk hazel health heart
hedge helmet hero hidden highway hill hint hobby hockey hollow honey hood hope horizon horse hospital hotel hour
humble humor hundred hurdle husband hybrid icon idea igloo image impact inch income index indoor infant inner insect
inside island ivory jacket jaguar jar jazz jelly jewel journey judge juice jungle junior kayak kernel kettle
keyboard kidney kind kingdom kitchen kite kitten kiwi knee knife label ladder lady lagoon lake lamp language laptop
large laser latin laundry lava lawn layer leader leaf lecture legend lemon lens leopard lesson letter level liberty
library license light lilac lily limit linen lion liquid list little lizard lobster local lock lodge logic lonely
lottery lounge loyal lucky lumber lunar lunch luxury lyrics machine magic magnet maize major mammal mango mansion
maple marble march margin marine market marsh mask master matrix meadow medal melody melon member memory mentor menu
mercy merit mesh metal method middle midnight milk mimic mineral minute mirror mission mixture model modern moment
monitor monkey month moral morning mosquito mother motion motor mountain mouse muffin mule museum music mustard myth
napkin narrow nation nature near nectar needle nephew nerve network neutral never noble noodle normal north notable
notice novel nugget number nurse nutmeg oasis object ocean october odor office olive omega onion online open opera
option orange orbit orchard order organ origin orphan ostrich other otter outdoor oval oven owner oxygen oyster
paddle page palace palm panda panel panther paper parade parent parrot party pasta pastry patrol pause peace peach
peanut pear pebble pelican pencil penguin pepper perfect permit person piano picnic picture piece pigeon pillow
pilot pink pioneer pipe planet plastic plate play pledge plenty plum pocket poem poet polar pony popcorn porch
portion potato pottery powder power praise prefer pretty prince prison prize problem process produce profit project
proof proud pulse pumpkin pupil puppy purple puzzle pyramid quality quarter queen question quick quiet quilt quote
rabbit raccoon radar radio rail rain rainbow raisin ranch random rapid raven razor ready rebel recipe record reform
region relax remedy repair rescue resort retire ribbon rice rich ridge ripple river road robin robot rocket romance
roof rookie rose rotate rough round route royal rubber ruby rural saddle safari salad salmon salon sample sand satin
sauce sausage scale scarf scene school science scout screen script sculpture season second secret section seed
segment select seminar senior sense sequence series service session settle seven shadow shallow shark sheep shelf
shell shelter sheriff shield shiny ship shoe shore short shoulder shrimp siege signal silent silk silver simple
siren sister sketch skill skirt sleep slender slice slogan slope small smile smooth snack snake snow soap soccer
social socket soda soft solar soldier solid solution sonic soup south space spare sparrow speak spice spider spirit
splash sponge spoon sport spring spruce square squirrel stable stadium staff stage stairs stamp start statue steak
steel stem stereo stick still stone stool story stove strategy straw stream street strong student studio style sugar
suit summer summit sunny sunset super supply supreme surface surge survey sushi swamp swan sweater sweet swift swim
swing symbol syrup system table tackle tail talent tank target taxi teach team tennis tent theme theory thrive thumb
thunder ticket tide tiger timber tiny title toast today toddler token tomato tongue topic torch tornado tortoise
total tourist tower town toy track trade traffic tragic train travel tray treat tree trend trial tribe trick trophy
tropical truck trumpet trust truth tulip tuna tunnel turkey turtle tutor twelve twenty twin type umbrella uncle
under unicorn union unique unit universe upper urban useful usual vacant valley valve vanilla vapor velvet vendor
venue verb version vessel veteran video village vintage violin virtual visa visit visual vital vivid vocal voice
volcano volume voyage wagon walnut warm wash water wave wealth weather wedding weekend welcome west whale wheat
wheel whisper width wild willow window wine wing winter wisdom wizard wolf wonder wood wool world worth wreath wrist
yacht yard yellow yogurt young zebra zero zone zoo
`;

function lista(texto: string): readonly string[] {
  return Object.freeze(
    texto
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => /^[a-z]+$/.test(p)),
  );
}

export const PALAVRAS_PT = lista(pt);
export const PALAVRAS_EN = lista(en);
